import * as vscode from 'vscode';
import { ConnData } from './connections';
import { getPool, PoolConfig } from './driver';

const axios = require('axios');

function parseTrinoCatalogSchema(database?: string): { catalog?: string; schema?: string } {
  const raw = (database || '').trim();
  if (!raw || raw === '*' || raw.toLowerCase() === 'all') {
    return {};
  }

  if (raw.includes('/')) {
    const [catalog, schema] = raw.split('/').map(v => v.trim());
    return { catalog: catalog || undefined, schema: schema || undefined };
  }

  if (raw.includes('.')) {
    const [catalog, schema] = raw.split('.').map(v => v.trim());
    return { catalog: catalog || undefined, schema: schema || undefined };
  }

  return { catalog: raw };
}

function buildTrinoStatementUrl(hostInput: string, port: number): string {
  const trimmedHost = (hostInput || '').trim();
  const defaultProtocol = port === 443 ? 'https' : 'http';
  const hasScheme = /^https?:\/\//i.test(trimmedHost);
  const parsed = new URL(hasScheme ? trimmedHost : `${defaultProtocol}://${trimmedHost}`);

  if (!parsed.port && Number.isFinite(port) && port > 0) {
    parsed.port = String(port);
  }

  let basePath = parsed.pathname || '';
  if (basePath.endsWith('/v1/statement')) {
    basePath = basePath.slice(0, -('/v1/statement'.length));
  }
  basePath = basePath.replace(/\/+$/, '');

  return `${parsed.protocol}//${parsed.host}${basePath}/v1/statement`;
}

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
            port: parseInt(port, 10),
            password: password
          };

          if (!tempConfig.password && displayName) {
             const passwordKey = `sqlnotebook.${displayName}`;
             try {
               tempConfig.password = await this.context.secrets.get(passwordKey);
             } catch(e) {}
          }

          if (!isValid(tempConfig, true)) {
            return;
          }

          if (tempConfig.driver === 'trino') {
            try {
              vscode.window.setStatusBarMessage('$(sync~spin) Testing Trino connection...', 3000);
              const parsed = parseTrinoCatalogSchema(tempConfig.database);
              const catalog = parsed.catalog || 'system';
              const schema = parsed.schema || (catalog === 'system' ? 'runtime' : 'default');
              const url = buildTrinoStatementUrl(tempConfig.host, tempConfig.port);

              const response = await axios.post(url, 'SELECT 1', {
                headers: {
                  'X-Trino-User': tempConfig.user,
                  'X-Trino-Catalog': catalog || 'tpch',
                  'X-Trino-Schema': schema || 'default',
                },
                auth: {
                  username: tempConfig.user,
                  password: tempConfig.password || ''
                },
                timeout: 5000
              });

              if (response.status === 200 && response.data && response.data.stats) {
                const state = response.data.stats.state;
                if (state === 'FINISHED' || state === 'QUEUED') {
                  vscode.window.showInformationMessage(`Connection Test Successful! Estado: ${state} ✅`);
                } else {
                  throw new Error(`Trino returned status ${state}`);
                }
              } else {
                const state = response.data && response.data.stats ? response.data.stats.state : 'UNKNOWN';
                throw new Error(`Trino returned status ${state}`);
              }
            } catch (err: any) {
              let message = err.message;
              if (err.response && err.response.data && err.response.data.message) {
                message = err.response.data.message;
              }
              vscode.window.showErrorMessage(`Connection Failed: ${message}`);
            }
            break;
          }

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
            port: parseInt(port, 10),
          };

          if (!isValid(newConfig)) {
            return;
          }

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
    if (config.path) {
      return true;
    }
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
  const nonce = getNonce();
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <title>New Connection</title>
    </head>
    <body>
      <div id="root"></div>
      <script nonce="${nonce}" src="${bundlePath}"></script>
    </body>
  </html>`;
}

function getUri(webview: vscode.Webview, extensionUri: vscode.Uri, pathList: string[]) {
  return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...pathList));
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}