import * as vscode from 'vscode';
export class ParameterProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sqlnotebook.parameters';
  private _view?: vscode.WebviewView;
  private _activeUri: string | null = null;
  private _savedParamsByUri = new Map<
    string,
    Record<string, StoredParameter>
  >();
  private _runtimeParamsByUri = new Map<
    string,
    Record<string, StoredParameter>
  >();
  private _paramDirtyByUri = new Map<string, boolean>();
  private _lastSentIsDirtyByUri = new Map<string, boolean>();
  private _explicitSaveRequests = new Set<string>();
  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
  ) {
    this._context.subscriptions.push(
      vscode.workspace.onWillSaveNotebookDocument((event) => {
        if (event.notebook.notebookType !== 'sql-notebook') {
          return;
        }
        const uriKey = event.notebook.uri.toString();
        const pending = this._runtimeParamsByUri.get(uriKey);
        if (pending) {
          const currentMetadata = event.notebook.metadata || {};
          const custom = currentMetadata.custom || {};
          const savedParams = (custom.parameters || {}) as Record<
            string,
            StoredParameter
          >;
          if (!areParamsEqual(savedParams, pending)) {
            const edit = new vscode.WorkspaceEdit();
            edit.set(event.notebook.uri, [
              vscode.NotebookEdit.updateNotebookMetadata({
                ...currentMetadata,
                custom: { ...custom, parameters: pending },
              }),
            ]);
            event.waitUntil(vscode.workspace.applyEdit(edit));
          }
        }
      }),
    );
    this._context.subscriptions.push(
      vscode.workspace.onDidSaveNotebookDocument((notebook) => {
        if (notebook.notebookType !== 'sql-notebook') {
          return;
        }
        const uriKey = notebook.uri.toString();
        const savedParams = (notebook.metadata?.custom?.parameters ||
          {}) as Record<string, StoredParameter>;
        this._savedParamsByUri.set(uriKey, savedParams);
        this._paramDirtyByUri.set(uriKey, false);
        if (this._activeUri === uriKey) {
          this.updateWebviewState({
            isDirty: false,
            hasActiveFile: true,
          });
          this._view?.webview.postMessage({
            type: 'save_now_result',
            payload: { message: 'Saved' },
          });
        }
      }),
    );
    this._context.subscriptions.push(
      vscode.workspace.onDidChangeNotebookDocument((event) => {
        if (event.notebook.notebookType !== 'sql-notebook') {
          return;
        }
        if (this._activeUri === event.notebook.uri.toString()) {
          const isDirty = this._computeIsDirty(this._activeUri);
          this.updateWebviewState({
            isDirty,
            hasActiveFile: true,
          });
        }
      }),
    );
    this._context.subscriptions.push(
      vscode.workspace.onDidCloseNotebookDocument((notebook) => {
        if (notebook.notebookType !== 'sql-notebook') {
          return;
        }
        const uriKey = notebook.uri.toString();
        this._runtimeParamsByUri.delete(uriKey);
        this._savedParamsByUri.delete(uriKey);
        this._paramDirtyByUri.delete(uriKey);
        this._lastSentIsDirtyByUri.delete(uriKey);
        this._explicitSaveRequests.delete(uriKey);
        if (this._activeUri === uriKey) {
          this._activeUri = null;
          this._refreshWebviewWithEmpty();
        }
      }),
    );
    this._context.subscriptions.push(
      vscode.window.onDidChangeActiveNotebookEditor((editor) => {
        this._updateWebviewForEditor(editor);
      }),
    );
  }
  private _computeIsDirty(uri: string): boolean {
    const notebook = vscode.workspace.notebookDocuments.find(
      (nb) => nb.uri.toString() === uri,
    );
    const isNotebookDirty = notebook ? notebook.isDirty : false;

    const savedParams =
      this._savedParamsByUri.get(uri) ||
      ((notebook?.metadata?.custom?.parameters || {}) as Record<
        string,
        StoredParameter
      >);
    const runtimeParams = this._runtimeParamsByUri.get(uri);
    const displayParams =
      runtimeParams !== undefined ? runtimeParams : savedParams;

    const isParamsDirty =
      (this._paramDirtyByUri.get(uri) ?? false) ||
      !areParamsEqual(savedParams, displayParams);

    return isNotebookDirty || isParamsDirty;
  }
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.type === 'ready') {
        this._updateWebviewForEditor(vscode.window.activeNotebookEditor);
      }

      if (data.type === 'parameters_updated') {
        const { parameters, isDirty: webviewIsDirty } = data.payload;

        let targetUri = this._activeUri;
        if (!targetUri) {
          if (
            vscode.window.activeNotebookEditor?.notebook.notebookType ===
            'sql-notebook'
          ) {
            targetUri =
              vscode.window.activeNotebookEditor.notebook.uri.toString();
          } else {
            const visible = vscode.window.visibleNotebookEditors.find(
              (ne) => ne.notebook.notebookType === 'sql-notebook',
            );
            if (visible) {
              targetUri = visible.notebook.uri.toString();
            }
          }
        }
        if (targetUri) {
          this._activeUri = targetUri;
          this._runtimeParamsByUri.set(targetUri, parameters);

          const savedParams =
            this._savedParamsByUri.get(targetUri) ||
            ((vscode.window.activeNotebookEditor?.notebook.metadata?.custom
              ?.parameters || {}) as Record<string, StoredParameter>);

          const isParamsDiff = !areParamsEqual(savedParams, parameters);
          const isParamDirty = webviewIsDirty === true || isParamsDiff;
          this._paramDirtyByUri.set(targetUri, isParamDirty);

          const isDirty = this._computeIsDirty(targetUri);
          this.updateWebviewState({
            isDirty,
            hasActiveFile: true,
          });
        }
      }
      if (data.type === 'save_now') {
        let targetUri = this._activeUri;
        if (!targetUri) {
          if (
            vscode.window.activeNotebookEditor?.notebook.notebookType ===
            'sql-notebook'
          ) {
            targetUri =
              vscode.window.activeNotebookEditor.notebook.uri.toString();
          } else {
            const visible = vscode.window.visibleNotebookEditors.find(
              (ne) => ne.notebook.notebookType === 'sql-notebook',
            );
            if (visible) {
              targetUri = visible.notebook.uri.toString();
            }
          }
        }
        if (targetUri) {
          const notebook = vscode.workspace.notebookDocuments.find(
            (nb) => nb.uri.toString() === targetUri,
          );
          if (notebook) {
            const pending = this._runtimeParamsByUri.get(
              notebook.uri.toString(),
            );
            if (pending) {
              const currentMetadata = notebook.metadata || {};
              const custom = currentMetadata.custom || {};
              const savedParams = (custom.parameters || {}) as Record<
                string,
                StoredParameter
              >;
              if (!areParamsEqual(savedParams, pending)) {
                const edit = new vscode.WorkspaceEdit();
                edit.set(notebook.uri, [
                  vscode.NotebookEdit.updateNotebookMetadata({
                    ...currentMetadata,
                    custom: { ...custom, parameters: pending },
                  }),
                ]);
                await vscode.workspace.applyEdit(edit);
              }
            }
            await notebook.save();
          }
        }
      }
    });
    this._updateWebviewForEditor(vscode.window.activeNotebookEditor);
  }
  private _refreshWebviewWithEmpty() {
    this._view?.webview.postMessage({
      type: 'set_parameters',
      payload: {
        parameters: {},
        hasActiveFile: false,
        isDirty: false,
      },
    });
  }
  public updateWebviewState(state: {
    isDirty?: boolean;
    hasActiveFile?: boolean;
  }) {
    if (this._activeUri && state.isDirty !== undefined) {
      const prev = this._lastSentIsDirtyByUri.get(this._activeUri);
      if (prev === state.isDirty && state.hasActiveFile === undefined) {
        return;
      }
      this._lastSentIsDirtyByUri.set(this._activeUri, state.isDirty);
    }
    this._view?.webview.postMessage({
      type: 'update_state',
      payload: state,
    });
  }
  public refresh() {
    this._updateWebviewForEditor(vscode.window.activeNotebookEditor);
  }
  public onExternalSave(uri: string) {
    if (this._activeUri === uri) {
      const notebook = vscode.workspace.notebookDocuments.find(
        (nb) => nb.uri.toString() === uri,
      );
      if (notebook) {
        const savedParams = (notebook.metadata?.custom?.parameters ||
          {}) as Record<string, StoredParameter>;
        this._savedParamsByUri.set(uri, savedParams);
      }
      this._paramDirtyByUri.set(uri, false);
      this.updateWebviewState({
        isDirty: false,
        hasActiveFile: true,
      });
      this._view?.webview.postMessage({
        type: 'save_now_result',
        payload: { message: 'Saved' },
      });
    }
  }
  private _updateWebviewForEditor(editor: vscode.NotebookEditor | undefined) {
    if (editor && editor.notebook.notebookType === 'sql-notebook') {
      this._activeUri = editor.notebook.uri.toString();
      const notebook = editor.notebook;
      const savedParams = (notebook.metadata?.custom?.parameters || {}) as
        Record<string, StoredParameter>;
      this._savedParamsByUri.set(this._activeUri, savedParams);
      const runtimeParams = this._runtimeParamsByUri.get(this._activeUri);
      const displayParams =
        runtimeParams !== undefined ? runtimeParams : savedParams;
      const isDirty = this._computeIsDirty(this._activeUri);
      this._view?.webview.postMessage({
        type: 'set_parameters',
        payload: {
          parameters: displayParams,
          hasActiveFile: true,
          isDirty,
        },
      });
    } else {
      if (
        this._activeUri &&
        vscode.window.visibleNotebookEditors.some(
          (ne) => ne.notebook.uri.toString() === this._activeUri,
        )
      ) {
        return;
      }
      this._activeUri = null;
      this._refreshWebviewWithEmpty();
    }
  }
  public getParameters(uri?: string): Record<string, StoredParameter> {
    if (uri) {
      const runtime = this._runtimeParamsByUri.get(uri);
      if (runtime) {
        return runtime;
      }
      const notebook = vscode.workspace.notebookDocuments.find(
        (nb) => nb.uri.toString() === uri,
      );
      if (notebook?.metadata?.custom?.parameters) {
        return notebook.metadata.custom.parameters as Record<
          string,
          StoredParameter
        >;
      }
    }
    return {};
  }
  public notifyQueryExecutionStart(): void {
    if (this._view?.webview) {
      this._view.webview.postMessage({
        type: 'query_execution_start',
        payload: {},
      });
    }
  }
  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'dist',
        'webview',
        'parameters-bundle.js',
      ),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <title>SQL Parameters</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
function getNonce() {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}
function areParamsEqual(
  a: Record<string, StoredParameter>,
  b: Record<string, StoredParameter>,
): boolean {
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
type StoredParameter =
  | string
  | {
      value: string;
      raw?: boolean;
      type?: ParameterType;
      options?: string[];
      checked?: boolean;
      checkedValue?: string;
      uncheckedValue?: string;
      required?: boolean;
    };
function normalizeParam(param: StoredParameter): {
  value: string;
  raw: boolean;
  type: ParameterType;
  options: string[];
  checked: boolean;
  checkedValue: string;
  uncheckedValue: string;
  required: boolean;
} {
  if (typeof param === 'string') {
    return {
      value: param,
      raw: false,
      type: 'text',
      options: [],
      checked: false,
      checkedValue: 'true',
      uncheckedValue: 'false',
      required: false,
    };
  }
  if (param && typeof param === 'object') {
    const type =
      param.type === 'checkbox' || param.type === 'select'
        ? param.type
        : 'text';
    return {
      value: String(param.value ?? ''),
      raw: !!param.raw,
      type,
      options: Array.isArray(param.options)
        ? param.options.map((v) => String(v))
        : [],
      checked: !!param.checked,
      checkedValue: String(param.checkedValue ?? 'true'),
      uncheckedValue: String(param.uncheckedValue ?? 'false'),
      required: !!param.required,
    };
  }
  return {
    value: '',
    raw: false,
    type: 'text',
    options: [],
    checked: false,
    checkedValue: 'true',
    uncheckedValue: 'false',
    required: false,
  };
}
function getNotebookCellTexts(notebook: vscode.NotebookDocument): string[] {
  const texts: string[] = [];
  for (let i = 0; i < notebook.cellCount; i++) {
    texts.push(notebook.cellAt(i).document.getText());
  }
  return texts;
}
