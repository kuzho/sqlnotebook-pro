import * as vscode from 'vscode';
import { ConnData } from './connections';
import { getPool, PoolConfig } from './driver';

export let globalFormProvider: SQLConfigurationViewProvider | undefined;

export function activateFormProvider(context: vscode.ExtensionContext) {
  const provider = new SQLConfigurationViewProvider(
    'sqlnotebook.connectionForm',
    context
  );
  globalFormProvider = provider;
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(provider.viewId, provider)
  );
}

class SQLConfigurationViewProvider implements vscode.WebviewViewProvider {
  public readonly viewId: string;
  private readonly context: vscode.ExtensionContext;
  private _view?: vscode.WebviewView;

  constructor(viewId: string, context: vscode.ExtensionContext) {
    this.viewId = viewId;
    this.context = context;
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext<unknown>,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      enableForms: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = await getWebviewContent(webviewView.webview, this.context.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {

        case 'test_connection': {
          const { displayName, password, port, ...rest } = message.data;

          const tempConfig = {
            ...rest,
            name: 'TEST_CONN',
            port: parseInt(port),
            password: password
          };

          if (!tempConfig.password && displayName) {
             const passwordKey = `sqlnotebook.${displayName}`;
             try {
               tempConfig.password = await this.context.secrets.get(passwordKey);
             } catch(e) {}
          }

          if (!isValid(tempConfig, true)) return;

          try {
             vscode.window.setStatusBarMessage('$(sync~spin) Testing connection...', 2000);
             const pool = await getPool({
               ...tempConfig,
               queryTimeout: 5000
             } as PoolConfig);

             const conn = await pool.getConnection();
             await conn.query('SELECT 1');
             conn.release();
             pool.end();

             vscode.window.showInformationMessage(`Connection Test Successful! ✅`);
          } catch (err: any) {
             vscode.window.showErrorMessage(`Connection Failed: ${err.message}`);
          }
          break;
        }

        case 'create_connection': {
          const { displayName, password, port, group, ...rest } = message.data;
          const passwordKey = `sqlnotebook.${displayName}`;

          const newConfig = {
            ...rest,
            name: displayName,
            group: group || '',
            passwordKey,
            port: parseInt(port),
          };

          if (!isValid(newConfig)) return;

          const config = vscode.workspace.getConfiguration('sqlnotebook');
          const connections = config.get<ConnData[]>('connections') || [];
          const exists = connections.find(c => c.name === displayName);

          if (password && password.trim() !== '') {
            await this.context.secrets.store(passwordKey, password);
          } else if (!exists) {
            await this.context.secrets.store(passwordKey, '');
          }

          delete newConfig.password;

          const newConnectionsList = connections.filter(({ name }) => name !== displayName);
          newConnectionsList.push(newConfig);
          newConnectionsList.sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name));

          await config.update('connections', newConnectionsList, vscode.ConfigurationTarget.Global);

          await vscode.commands.executeCommand('sqlnotebook.refreshConnectionPanel');

          await vscode.commands.executeCommand('sqlnotebook.refreshKernels');

          webviewView.webview.postMessage({ type: 'clear_form' });
          break;
        }
      }
    });
  }

  public editConnection(config: ConnData) {
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ type: 'edit_connection', data: config });
    }
  }
}

function isValid(config: ConnData, isTest = false): boolean {
  if (config.driver === 'sqlite') {
    if (config.path) return true;
    vscode.window.showErrorMessage(`Invalid "Path".`);
    return false;
  }
  if (!isTest && !config.name) {
    vscode.window.showErrorMessage(`Invalid "Database Name".`);
    return false;
  }
  if (!config.host) {
    vscode.window.showErrorMessage(`Invalid "Host".`);
    return false;
  }
  if (isNaN(config.port)) {
    vscode.window.showErrorMessage(`Invalid "Port".`);
    return false;
  }
  return true;
}

async function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
  const bundlePath = getUri(webview, extensionUri, ['dist', 'webview', 'main-bundle.js']);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>New Connection</title></head><body><div id="root"></div><script src="${bundlePath}"></script></body></html>`;
}

function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}