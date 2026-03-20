import * as vscode from 'vscode';

export class ParameterProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sqlnotebook.parameters';
  private _view?: vscode.WebviewView;
  private _activeUri: string | null = null;
  private _runtimeParamsByUri = new Map<string, Record<string, StoredParameter>>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._activeUri = null;
      this._runtimeParamsByUri.clear();
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist')
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async data => {
      if (data.type === 'parameters_updated') {
        const { parameters } = data.payload;

        let targetUri = this._activeUri;
        if (!targetUri) {
          if (vscode.window.activeNotebookEditor?.notebook.notebookType === 'sql-notebook') {
            targetUri = vscode.window.activeNotebookEditor.notebook.uri.toString();
          } else {
            const visible = vscode.window.visibleNotebookEditors.find(ne => ne.notebook.notebookType === 'sql-notebook');
            if (visible) {
              targetUri = visible.notebook.uri.toString();
            }
          }
        }

        if (targetUri) {
          this._activeUri = targetUri;
          this._runtimeParamsByUri.set(targetUri, parameters);
        }
      }

      if (data.type === 'save_now') {
        let targetUri = this._activeUri;
        if (!targetUri) {
          if (vscode.window.activeNotebookEditor?.notebook.notebookType === 'sql-notebook') {
            targetUri = vscode.window.activeNotebookEditor.notebook.uri.toString();
          } else {
            const visible = vscode.window.visibleNotebookEditors.find(ne => ne.notebook.notebookType === 'sql-notebook');
            if (visible) {
              targetUri = visible.notebook.uri.toString();
            }
          }
        }

        if (targetUri) {
          const notebook = vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === targetUri);
          if (notebook) {
            const pending = this._runtimeParamsByUri.get(notebook.uri.toString());
            if (pending) {
              const currentMetadata = notebook.metadata || {};
              const custom = currentMetadata.custom || {};
              const currentParams = (custom.parameters || {}) as Record<string, StoredParameter>;
              if (!areParamsEqual(currentParams, pending)) {
                const edit = new vscode.WorkspaceEdit();
                edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata({
                  ...currentMetadata,
                  custom: { ...custom, parameters: pending }
                })]);
                await vscode.workspace.applyEdit(edit);
              }
            }
            await notebook.save();
            this._view?.webview.postMessage({
              type: 'save_now_result',
              payload: { message: 'Saved' }
            });
          }
        }
      }
    });

    this._context.subscriptions.push(
      vscode.workspace.onWillSaveNotebookDocument(async e => {
        const notebook = e.notebook;
        if (notebook.notebookType !== 'sql-notebook') {
          return;
        }
        if (e.reason !== vscode.TextDocumentSaveReason.Manual) {
          return;
        }
        const uriKey = notebook.uri.toString();
        const pending = this._runtimeParamsByUri.get(uriKey);
        if (!pending) {
          return;
        }
        const currentMetadata = notebook.metadata || {};
        const custom = currentMetadata.custom || {};
        const currentParams = (custom.parameters || {}) as Record<string, StoredParameter>;
        if (areParamsEqual(currentParams, pending)) {
          return;
        }
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata({
          ...currentMetadata,
          custom: { ...custom, parameters: pending }
        })]);
        await vscode.workspace.applyEdit(edit);
      })
    );

    this._context.subscriptions.push(
      vscode.workspace.onDidSaveNotebookDocument((notebook) => {
        if (notebook.notebookType !== 'sql-notebook') {
          return;
        }

        if (this._activeUri !== notebook.uri.toString()) {
          return;
        }

        this._view?.webview.postMessage({
          type: 'save_now_result',
          payload: { message: 'Saved' }
        });
      })
    );

    this._context.subscriptions.push(
      vscode.workspace.onDidCloseNotebookDocument((notebook) => {
        if (notebook.notebookType !== 'sql-notebook') {
          return;
        }

        const uriKey = notebook.uri.toString();
        this._runtimeParamsByUri.delete(uriKey);

        if (this._activeUri === uriKey) {
          this._activeUri = null;
          this._view?.webview.postMessage({
            type: 'set_parameters',
            payload: {
              parameters: {},
              hasActiveFile: false
            }
          });
        }
      })
    );



    vscode.window.onDidChangeActiveNotebookEditor(editor => {
      this._updateWebviewForEditor(editor);
    });

    if (vscode.window.activeNotebookEditor) {
      this._updateWebviewForEditor(vscode.window.activeNotebookEditor);
    }
  }

  private _updateWebviewForEditor(editor: vscode.NotebookEditor | undefined) {
    if (editor && editor.notebook.notebookType === 'sql-notebook') {
      this._activeUri = editor.notebook.uri.toString();
      const savedParams = editor.notebook.metadata?.custom?.parameters as Record<string, StoredParameter> | undefined;
      const runtimeParams = this._runtimeParamsByUri.get(this._activeUri);
      const displayParams = runtimeParams || savedParams || {};

      this._view?.webview.postMessage({
        type: 'set_parameters',
        payload: {
          parameters: displayParams,
          hasActiveFile: true
        }
      });
    } else {
      if (this._activeUri && vscode.window.visibleNotebookEditors.some(ne => ne.notebook.uri.toString() === this._activeUri)) {
        return;
      }

      this._activeUri = null;
      this._view?.webview.postMessage({
        type: 'set_parameters',
        payload: {
          parameters: {},
          hasActiveFile: false
        }
      });
    }
  }

  public getParameters(uri?: string): Record<string, StoredParameter> {
    if (uri) {
      const runtime = this._runtimeParamsByUri.get(uri);
      if (runtime) {
        return runtime;
      }
      const notebook = vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === uri);
      if (notebook?.metadata?.custom?.parameters) {
        return notebook.metadata.custom.parameters as Record<string, StoredParameter>;
      }
    }
    return {};
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'parameters-bundle.js')
    );

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>SQL Parameters</title>
      </head>
      <body>
        <div id="root"></div>
        <script src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function areParamsEqual(a: Record<string, StoredParameter>, b: Record<string, StoredParameter>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i]) {
      return false;
    }
    const aNorm = normalizeParam(a[key] as StoredParameter);
    const bNorm = normalizeParam(b[key] as StoredParameter);
    if (JSON.stringify(aNorm) !== JSON.stringify(bNorm)) {
      return false;
    }
  }
  return true;
}

type ParameterType = 'text' | 'checkbox' | 'select';

type StoredParameter = string | {
  value: string;
  raw?: boolean;
  type?: ParameterType;
  options?: string[];
  checked?: boolean;
  checkedValue?: string;
  uncheckedValue?: string;
};

function normalizeParam(param: StoredParameter): {
  value: string;
  raw: boolean;
  type: ParameterType;
  options: string[];
  checked: boolean;
  checkedValue: string;
  uncheckedValue: string;
} {
  if (typeof param === 'string') {
    return {
      value: param,
      raw: false,
      type: 'text',
      options: [],
      checked: false,
      checkedValue: 'true',
      uncheckedValue: 'false'
    };
  }
  if (param && typeof param === 'object') {
    const type = param.type === 'checkbox' || param.type === 'select' ? param.type : 'text';
    return {
      value: String(param.value ?? ''),
      raw: !!param.raw,
      type,
      options: Array.isArray(param.options) ? param.options.map(v => String(v)) : [],
      checked: !!param.checked,
      checkedValue: String(param.checkedValue ?? 'true'),
      uncheckedValue: String(param.uncheckedValue ?? 'false')
    };
  }
  return {
    value: '',
    raw: false,
    type: 'text',
    options: [],
    checked: false,
    checkedValue: 'true',
    uncheckedValue: 'false'
  };
}