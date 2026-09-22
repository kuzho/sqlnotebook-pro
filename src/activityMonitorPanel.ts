import * as vscode from 'vscode';
import { ConnData } from './connections';
import { getPool } from './driver';

export class ActivityMonitorPanel {
  public static currentPanel: ActivityMonitorPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _config: ConnData;

  public static async createOrShow(extensionUri: vscode.Uri, config: ConnData) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ActivityMonitorPanel.currentPanel) {
      ActivityMonitorPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'activityMonitor',
      `Activity Monitor: ${config.name || 'Server'}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    ActivityMonitorPanel.currentPanel = new ActivityMonitorPanel(
      panel,
      extensionUri,
      config,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    config: ConnData,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._config = config;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
          case 'refresh':
            await this._loadData();
            break;
          case 'kill_process':
            await this._killProcess(message.data);
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public dispose() {
    ActivityMonitorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _loadData() {
    try {
      const pool = await getPool(this._config);
      const conn = await pool.getConnection();
      try {
        let query = '';
        if (this._config.driver === 'mssql') {
          query = `
          SELECT
            s.session_id,
            s.status,
            s.login_name,
            COALESCE(s.host_name, c.client_net_address) as host_name,
            DB_NAME(COALESCE(r.database_id, s.database_id)) as database_name,
            COALESCE(r.command, 'SLEEPING') as command,
            s.cpu_time,
            s.total_elapsed_time,
            r.wait_type,
            r.blocking_session_id,
            t.text as sql_text
          FROM sys.dm_exec_sessions s
          LEFT JOIN sys.dm_exec_requests r ON r.session_id = s.session_id
          LEFT JOIN sys.dm_exec_connections c ON s.session_id = c.session_id
          OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
          WHERE s.is_user_process = 1
        `;
        } else if (this._config.driver === 'postgres') {
          query = `
          SELECT
            pid as session_id,
            state as status,
            usename as login_name,
            COALESCE(client_hostname, CAST(client_addr as TEXT)) as host_name,
            datname as database_name,
            query as command,
            0 as cpu_time,
            EXTRACT(EPOCH FROM (now() - query_start))*1000 as total_elapsed_time,
            wait_event_type as wait_type,
            array_to_string(pg_blocking_pids(pid), ',') as blocking_session_id,
            query as sql_text
          FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
        `;
        } else {
          query =
            'SELECT 1 as session_id, "Not supported on this driver" as command';
        }

        const res = await conn.query(query);
        const getRows = (r: any) => {
          if (!r || r.length === 0) return [];
          const first = r[0];
          if (Array.isArray(first)) return first;
          if (first.rows && Array.isArray(first.columns)) {
            if (first.rows.length > 0 && Array.isArray(first.rows[0])) {
              return first.rows.map((row: any[]) => {
                const obj: any = {};
                first.columns.forEach((col: string, i: number) => {
                  obj[col] = row[i];
                });
                return obj;
              });
            }
          }
          return first.rows || [];
        };
        const data = getRows(res);

        this._panel.webview.postMessage({
          type: 'data',
          data: data,
        });
      } finally {
        conn.release();
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error loading activity: ${e.message}`);
    }
  }

  private async _killProcess(spid: number) {
    vscode.window
      .showWarningMessage(
        `Are you sure you want to KILL session ${spid}?`,
        'Yes',
        'No',
      )
      .then(async (selection) => {
        if (selection === 'Yes') {
          try {
            const pool = await getPool(this._config);
            const conn = await pool.getConnection();
            try {
              if (this._config.driver === 'mssql') {
                await conn.query(`KILL ${spid}`);
              } else if (this._config.driver === 'postgres') {
                await conn.query(`SELECT pg_terminate_backend(${spid})`);
              }
              vscode.window.showInformationMessage(
                `Session ${spid} killed successfully.`,
              );
              await this._loadData();
            } finally {
              conn.release();
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(
              `Error killing process: ${e.message}`,
            );
          }
        }
      });
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'dist',
        'webview',
        'monitor-bundle.js',
      ),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Activity Monitor</title>
        <style>
          body { padding: 0; margin: 0; }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}?v=${nonce}"></script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
