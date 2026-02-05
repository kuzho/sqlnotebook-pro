import * as vscode from 'vscode';

export class ParameterProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sqlnotebook.parameters';
  private _view?: vscode.WebviewView;
  private _globalParameters: Record<string, string> = {};
  private _activeUri: string | null = null;
  private _pendingLocalParamsByUri = new Map<string, Record<string, string>>();
  private _useLocalByUri = new Map<string, boolean>();
  private _runtimeParamsByUri = new Map<string, Record<string, string>>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._globalParameters = this._context.workspaceState.get<Record<string, string>>('sqlnotebook.globalParams') || {};
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'dist')
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async data => {
      if (data.type === 'parameters_updated') {
        const { parameters, useLocal } = data.payload;

        let targetUri = this._activeUri;
        if (!targetUri) {
            if (vscode.window.activeNotebookEditor?.notebook.notebookType === 'sql-notebook') {
                targetUri = vscode.window.activeNotebookEditor.notebook.uri.toString();
            } else {
                const visible = vscode.window.visibleNotebookEditors.find(ne => ne.notebook.notebookType === 'sql-notebook');
                if (visible) targetUri = visible.notebook.uri.toString();
            }
        }

        if (targetUri) {
          this._activeUri = targetUri;
          let notebook = vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === targetUri);

          if (!notebook) {
             const visible = vscode.window.visibleNotebookEditors.find(ne => ne.notebook.notebookType === 'sql-notebook');
             if (visible) {
                 notebook = visible.notebook;
                 this._activeUri = notebook.uri.toString();
             }
          }

          if (notebook) {
            const uriKey = notebook.uri.toString();
            this._useLocalByUri.set(uriKey, !!useLocal);
            this._runtimeParamsByUri.set(uriKey, parameters);

            if (useLocal) {
              this._pendingLocalParamsByUri.set(uriKey, parameters);
            }
          }
        }

        if (!useLocal) {
          if (!areParamsEqual(this._globalParameters, parameters)) {
            this._globalParameters = parameters;
            this._context.workspaceState.update('sqlnotebook.globalParams', parameters);
          }
        }
      }

      if (data.type === 'save_now') {
        let targetUri = this._activeUri;
        if (!targetUri) {
          if (vscode.window.activeNotebookEditor?.notebook.notebookType === 'sql-notebook') {
            targetUri = vscode.window.activeNotebookEditor.notebook.uri.toString();
          } else {
            const visible = vscode.window.visibleNotebookEditors.find(ne => ne.notebook.notebookType === 'sql-notebook');
            if (visible) targetUri = visible.notebook.uri.toString();
          }
        }

        if (targetUri) {
          const notebook = vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === targetUri);
          if (notebook) {
            const uriKey = notebook.uri.toString();
            const useLocal = this._useLocalByUri.get(uriKey);

            if (useLocal) {
              const pending = this._pendingLocalParamsByUri.get(uriKey);
              if (pending) {
                const currentMetadata = notebook.metadata || {};
                const custom = currentMetadata.custom || {};
                const currentParams = (custom.parameters || {}) as Record<string, string>;

                if (!areParamsEqual(currentParams, pending)) {
                  const edit = new vscode.WorkspaceEdit();
                  edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata({
                    ...currentMetadata,
                    custom: { ...custom, parameters: pending }
                  })]);
                  await vscode.workspace.applyEdit(edit);
                }
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
        if (notebook.notebookType !== 'sql-notebook') return;

        const uriKey = notebook.uri.toString();
        const useLocal = this._useLocalByUri.get(uriKey);
        if (!useLocal) return;

        const pending = this._pendingLocalParamsByUri.get(uriKey);
        if (!pending) return;

        const currentMetadata = notebook.metadata || {};
        const custom = currentMetadata.custom || {};
        const currentParams = (custom.parameters || {}) as Record<string, string>;

        if (areParamsEqual(currentParams, pending)) return;

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
        if (notebook.notebookType !== 'sql-notebook') return;
        const uriKey = notebook.uri.toString();
        const useLocal = this._useLocalByUri.get(uriKey);
        if (!useLocal) return;
        if (!notebook.metadata?.custom?.parameters) return;

        vscode.window.setStatusBarMessage('SQL Parameters saved', 2000);
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
      const localParams = editor.notebook.metadata?.custom?.parameters;
      this._useLocalByUri.set(this._activeUri, !!localParams);

      this._view?.webview.postMessage({
        type: 'set_parameters',
        payload: {
          parameters: localParams || this._globalParameters,
          useLocal: !!localParams,
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
          parameters: this._globalParameters,
          useLocal: false,
          hasActiveFile: false
        }
      });
    }
  }

  public getParameters(uri?: string): Record<string, string> {
    if (uri) {
      const notebook = vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === uri);
      const runtime = this._runtimeParamsByUri.get(uri);
      if (runtime) return runtime;
      if (notebook && notebook.metadata?.custom?.parameters) {
        const stored = notebook.metadata.custom.parameters;
        this._runtimeParamsByUri.set(uri, stored);
        return stored;
      }
    }
    return this._globalParameters;
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

function areParamsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i]) return false;
    if (String(a[key]) !== String(b[key])) return false;
  }
  return true;
}