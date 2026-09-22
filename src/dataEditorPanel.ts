import * as vscode from 'vscode';
import * as path from 'path';
import { ConnData } from './connections';
import { getPool } from './driver';

export class DataEditorPanel {
  public static currentPanel: DataEditorPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _config: ConnData;
  private _tableName: string;
  private _primaryKeys: string[];

  public static async createOrShow(
    extensionUri: vscode.Uri,
    config: ConnData,
    tableName: string,
    primaryKeys: string[],
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DataEditorPanel.currentPanel) {
      DataEditorPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'dataEditor',
      `Edit Data: ${tableName}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    DataEditorPanel.currentPanel = new DataEditorPanel(
      panel,
      extensionUri,
      config,
      tableName,
      primaryKeys,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    config: ConnData,
    tableName: string,
    primaryKeys: string[],
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._config = config;
    this._tableName = tableName;
    this._primaryKeys = primaryKeys;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
          case 'refresh':
            await this._loadData();
            break;
          case 'save_changes':
            await this._saveChanges(message.data);
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public dispose() {
    DataEditorPanel.currentPanel = undefined;
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
      let query = '';
      if (this._config.driver === 'mssql') {
        query = `SELECT TOP 200 * FROM ${this._tableName}`;
      } else {
        query = `SELECT * FROM ${this._tableName} LIMIT 200`;
      }

      const conn = await pool.getConnection();
      let res: any;
      try {
        res = await conn.query(query);
      } finally {
        conn.release();
      }

      const firstResult = res[0];
      let rows: any[] = [];
      let columns: string[] = [];
      
      if (Array.isArray(firstResult)) {
         rows = firstResult;
         if (rows.length > 0) columns = Object.keys(rows[0]);
      } else if (firstResult) {
         rows = firstResult.rows || [];
         columns = firstResult.columns || [];
         if (columns.length === 0 && rows.length > 0 && !Array.isArray(rows[0])) {
            columns = Object.keys(rows[0]);
         }
      }

      this._panel.webview.postMessage({
        type: 'init_data',
        data: {
          columns,
          rows,
          primaryKeys: this._primaryKeys,
          tableName: this._tableName,
        },
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error loading data: ${e.message}`);
    }
  }

  private async _saveChanges(payload: any[]) {
    if (this._primaryKeys.length === 0) {
      vscode.window.showErrorMessage(
        'Cannot save changes: Table has no primary key.',
      );
      return;
    }

    try {
      const pool = await getPool(this._config);
      const conn = await pool.getConnection();
      try {
        for (const update of payload) {
        const setClauses: string[] = [];
        const setValues: any[] = [];
        const whereClauses: string[] = [];
        const whereValues: any[] = [];

        Object.keys(update.newValues).forEach((col, i) => {
          setClauses.push(`${col} = @param${i}`);
          setValues.push(update.newValues[col]);
        });

        const offset = setValues.length;
        Object.keys(update.pkValues).forEach((col, i) => {
          whereClauses.push(`${col} = @param${i + offset}`);
          whereValues.push(update.pkValues[col]);
        });

        let sql = `UPDATE ${this._tableName} SET `;
        let sets = Object.keys(update.newValues).map((c) => {
          let val = update.newValues[c];
          if (val === null) return `${c} = NULL`;
          if (typeof val === 'string')
            return `${c} = '${val.replace(/'/g, "''")}'`;
          return `${c} = ${val}`;
        });
        let wheres = Object.keys(update.pkValues).map((c) => {
          let val = update.pkValues[c];
          if (val === null) return `${c} IS NULL`;
          if (typeof val === 'string')
            return `${c} = '${val.replace(/'/g, "''")}'`;
          return `${c} = ${val}`;
        });

        sql += sets.join(', ') + ' WHERE ' + wheres.join(' AND ');
        await conn.query(sql);
      }
      } finally {
        conn.release();
      }

      vscode.window.showInformationMessage('Data saved successfully.');
      this._panel.webview.postMessage({ type: 'save_success' });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error saving data: ${e.message}`);
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
        'editor-bundle.js',
      ),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Data Editor</title>
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
