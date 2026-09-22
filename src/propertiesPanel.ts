import * as vscode from 'vscode';
import { ConnData } from './connections';
import { getPool } from './driver';

export class PropertiesPanel {
  public static currentPanel: PropertiesPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _config: ConnData;
  private _itemContext: any;

  public static async createOrShow(extensionUri: vscode.Uri, itemContext: any) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (PropertiesPanel.currentPanel) {
      PropertiesPanel.currentPanel._panel.reveal(column);
      return;
    }

    const title =
      itemContext.viewItem === 'database'
        ? `Database Properties: ${itemContext.label}`
        : `Table Properties: ${itemContext.label}`;

    const panel = vscode.window.createWebviewPanel(
      'propertiesPanel',
      title,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    PropertiesPanel.currentPanel = new PropertiesPanel(
      panel,
      extensionUri,
      itemContext,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    itemContext: any,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._config = itemContext.config;
    this._itemContext = itemContext;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            await this._loadData();
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public dispose() {
    PropertiesPanel.currentPanel = undefined;
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
      const isTable =
        this._itemContext.viewItem === 'table' ||
        this._itemContext.viewItem === 'system_table';
      const isDatabase = this._itemContext.viewItem === 'database';
      const name = this._itemContext.label;
      const schema = this._itemContext.tableSchema?.schema || 'dbo';

      const pool = await getPool(this._config);
      const conn = await pool.getConnection();
      const getRows = (res: any) => {
        if (!res || res.length === 0) return [];
        const first = res[0];
        return Array.isArray(first) ? first : first.rows || [];
      };
      try {
        let props: any = {
          Name: name,
          'Server Type': this._config.driver,
        };

        if (this._config.driver === 'mssql') {
          if (isTable) {
            props['Schema'] = schema;
            const res = await conn.query(
              `EXEC sp_spaceused '${schema}.${name}'`,
            );
            const rows1 = getRows(res);
            if (rows1 && rows1.length > 0) {
              const data = rows1[0];
              props['Rows'] = data.rows;
              props['Data Space'] = data.data;
              props['Index Space'] = data.index_size;
              props['Total Space'] = data.reserved;
            }
            const createDateRes = await conn.query(
              `SELECT create_date, modify_date FROM sys.tables WHERE name = '${name}' AND schema_id = SCHEMA_ID('${schema}')`,
            );
            const createDateRows = getRows(createDateRes);
            if (createDateRows && createDateRows.length > 0) {
              props['Created Date'] = createDateRows[0].create_date;
              props['Last Modified Date'] = createDateRows[0].modify_date;
            }
          } else if (isDatabase) {
            const res = await conn.query(
              `SELECT create_date, compatibility_level, collation_name, state_desc FROM sys.databases WHERE name = '${name}'`,
            );
            const rows3 = getRows(res);
            if (rows3 && rows3.length > 0) {
              const data = rows3[0];
              props['Created Date'] = data.create_date;
              props['Compatibility Level'] = data.compatibility_level;
              props['Collation'] = data.collation_name;
              props['State'] = data.state_desc;
            }
          }
        } else if (this._config.driver === 'postgres') {
          if (isTable) {
            props['Schema'] = schema;
            const res = await conn.query(`
              SELECT
                pg_size_pretty(pg_total_relation_size('"${schema}"."${name}"')) as total_size,
                pg_size_pretty(pg_relation_size('"${schema}"."${name}"')) as data_size,
                pg_size_pretty(pg_indexes_size('"${schema}"."${name}"')) as index_size,
                (SELECT reltuples::bigint FROM pg_class WHERE oid = '"${schema}"."${name}"'::regclass) as row_count
            `);
            const rows4 = getRows(res);
            if (rows4 && rows4.length > 0) {
              const data = rows4[0];
              props['Estimated Rows'] = data.row_count;
              props['Data Space'] = data.data_size;
              props['Index Space'] = data.index_size;
              props['Total Space'] = data.total_size;
            }
          } else if (isDatabase) {
            const res = await conn.query(
              `SELECT pg_size_pretty(pg_database_size('${name}')) as db_size, pg_encoding_to_char(encoding) as encoding FROM pg_database WHERE datname = '${name}'`,
            );
            const rows5 = getRows(res);
            if (rows5 && rows5.length > 0) {
              props['Total Size'] = rows5[0].db_size;
              props['Encoding'] = rows5[0].encoding;
            }
          }
        } else {
          props['Notice'] =
            'Advanced properties are only implemented for MSSQL and Postgres in V1.';
        }

        this._panel.webview.postMessage({
          type: 'data',
          data: {
            title: isTable
              ? `Table Properties - ${name}`
              : `Database Properties - ${name}`,
            properties: props,
          },
        });
      } finally {
        conn.release();
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error loading properties: ${e.message}`);
    }
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
        'properties-bundle.js',
      ),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Properties</title>
        <style>
          body { padding: 0; margin: 0; }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
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
