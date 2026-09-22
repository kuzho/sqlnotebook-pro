import * as vscode from 'vscode';
import { ConnData } from './connections';
import { getPool, escapeIdentifier, mapDialectType } from './driver';

export class TableDesignerPanel {
  public static currentPanel: TableDesignerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _config: ConnData;

  public static async createOrShow(extensionUri: vscode.Uri, config: ConnData) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (TableDesignerPanel.currentPanel) {
      TableDesignerPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'tableDesigner',
      `New Table: ${config.name || 'Server'}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    TableDesignerPanel.currentPanel = new TableDesignerPanel(
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
          case 'error':
            vscode.window.showErrorMessage(message.data);
            break;
          case 'save':
            await this._saveTable(message.data);
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public dispose() {
    TableDesignerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _saveTable(data: any) {
    const { schema, table, columns } = data;

    let tableName = escapeIdentifier(this._config.driver, table);
    if (schema) {
      if (
        this._config.driver === 'postgres' ||
        this._config.driver === 'mssql'
      ) {
        tableName = `${escapeIdentifier(this._config.driver, schema)}.${tableName}`;
      }
    }

    const colDefs: string[] = [];
    const pks: string[] = [];

    for (const col of columns) {
      let typeStr = mapDialectType(this._config.driver, col.type);

      if (
        col.length &&
        ['varchar', 'nvarchar', 'char', 'decimal', 'numeric'].includes(col.type)
      ) {
        typeStr += `(${col.length})`;
      }

      let def = `${escapeIdentifier(this._config.driver, col.name)} ${typeStr}`;

      if (!col.isNull) {
        def += ' NOT NULL';
      }

      colDefs.push(def);

      if (col.isPk) {
        pks.push(escapeIdentifier(this._config.driver, col.name));
      }
    }

    if (pks.length > 0) {
      colDefs.push(`PRIMARY KEY (${pks.join(', ')})`);
    }

    const sql = `CREATE TABLE ${tableName} (\n  ${colDefs.join(',\n  ')}\n);`;

    try {
      const pool = await getPool(this._config);
      const conn = await pool.getConnection();
      try {
        await conn.query(sql);
        vscode.window.showInformationMessage(
          `Table ${tableName} created successfully!`,
        );

        vscode.commands.executeCommand('sqlnotebook.refreshConnectionPanel');

        this._panel.dispose();
      } finally {
        conn.release();
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error creating table: ${e.message}`);
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
        'designer-bundle.js',
      ),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Table Designer</title>
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
