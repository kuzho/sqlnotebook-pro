import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConnData } from './connections';
import { getPool } from './driver';

export class ImportWizardPanel {
  public static currentPanel: ImportWizardPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _config: ConnData;
  private _csvFilePath: string;
  private _csvData: any = null;

  public static async createOrShow(
    extensionUri: vscode.Uri,
    config: ConnData,
    csvFilePath: string,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ImportWizardPanel.currentPanel) {
      ImportWizardPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'importWizard',
      `Import CSV: ${path.basename(csvFilePath)}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    ImportWizardPanel.currentPanel = new ImportWizardPanel(
      panel,
      extensionUri,
      config,
      csvFilePath,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    config: ConnData,
    csvFilePath: string,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._config = config;
    this._csvFilePath = csvFilePath;

    this._update();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            await this._initData();
            break;
          case 'error':
            vscode.window.showErrorMessage(message.data);
            break;
          case 'import':
            await this._executeImport(message.data.table);
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public dispose() {
    ImportWizardPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _parseCsvLine(text: string): string[] {
    const re = /"([^"]*)"|([^,]+)/g;
    const result: string[] = [];
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match[1] !== undefined) result.push(match[1]);
      else result.push(match[2].trim());
    }
    return result.length > 0 ? result : text.split(',').map((s) => s.trim());
  }

  private async _initData() {
    try {
      const fileContent = fs.readFileSync(this._csvFilePath, 'utf-8');
      const lines = fileContent
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '');
      if (lines.length === 0) {
        throw new Error('File is empty.');
      }

      const headers = this._parseCsvLine(lines[0]).map((h) =>
        h.replace(/[^a-zA-Z0-9_]/g, ''),
      );
      const preview: any[] = [];

      for (let i = 1; i < Math.min(lines.length, 6); i++) {
        const vals = this._parseCsvLine(lines[i]);
        const rowObj: any = {};
        headers.forEach((h, idx) => {
          rowObj[h] = vals[idx] || '';
        });
        preview.push(rowObj);
      }

      this._csvData = {
        headers,
        lines: lines.slice(1), // exclude header
      };

      this._panel.webview.postMessage({
        type: 'init_data',
        data: {
          fileName: path.basename(this._csvFilePath),
          totalRows: lines.length - 1,
          headers: headers,
          preview: preview,
        },
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Error reading CSV: ${e.message}`);
    }
  }

  private async _executeImport(tableName: string) {
    if (!this._csvData) return;

    try {
      this._panel.webview.postMessage({
        type: 'progress',
        data: 'Creating table...',
      });
      const pool = await getPool(this._config);
      const conn = await pool.getConnection();
      try {
        let typeStr = 'VARCHAR(MAX)';
        if (this._config.driver === 'postgres') typeStr = 'TEXT';
        if (this._config.driver === 'sqlite') typeStr = 'TEXT';
        if (this._config.driver === 'mysql') typeStr = 'LONGTEXT';

        const colDefs = this._csvData.headers
          .map((h: string) => `[${h}] ${typeStr}`)
          .join(', ');
        let sqlCreate = `CREATE TABLE ${tableName} (${colDefs})`;
        if (this._config.driver === 'postgres') {
          sqlCreate = `CREATE TABLE ${tableName} (${this._csvData.headers.map((h: string) => `"${h}" ${typeStr}`).join(', ')})`;
        } else if (this._config.driver === 'mysql') {
          sqlCreate = `CREATE TABLE ${tableName} (${this._csvData.headers.map((h: string) => `\`${h}\` ${typeStr}`).join(', ')})`;
        } else if (this._config.driver === 'sqlite') {
          sqlCreate = `CREATE TABLE ${tableName} (${this._csvData.headers.map((h: string) => `"${h}" ${typeStr}`).join(', ')})`;
        }

        await conn.query(sqlCreate);

        this._panel.webview.postMessage({
          type: 'progress',
          data: 'Inserting rows...',
        });

        const batchSize = 100; // conservative batch
        const total = this._csvData.lines.length;
        let inserted = 0;

        for (let i = 0; i < total; i += batchSize) {
          const batchLines = this._csvData.lines.slice(i, i + batchSize);
          if (batchLines.length === 0) continue;

          let insertSql = '';
          if (
            this._config.driver === 'mssql' ||
            this._config.driver === 'postgres' ||
            this._config.driver === 'mysql'
          ) {
            const valsList = batchLines.map((line: string) => {
              const vals = this._parseCsvLine(line);
              const cleanVals = this._csvData.headers.map(
                (_: any, idx: number) => {
                  let v = vals[idx] || '';
                  return `'${v.replace(/'/g, "''")}'`;
                },
              );
              return `(${cleanVals.join(', ')})`;
            });
            let colsStr = this._csvData.headers
              .map((h: string) => `[${h}]`)
              .join(', ');
            if (this._config.driver === 'postgres')
              colsStr = this._csvData.headers
                .map((h: string) => `"${h}"`)
                .join(', ');
            if (this._config.driver === 'mysql')
              colsStr = this._csvData.headers
                .map((h: string) => `\`${h}\``)
                .join(', ');

            insertSql = `INSERT INTO ${tableName} (${colsStr}) VALUES ${valsList.join(', ')}`;
            await conn.query(insertSql);
          } else {
            for (const line of batchLines) {
              const vals = this._parseCsvLine(line);
              const cleanVals = this._csvData.headers.map(
                (_: any, idx: number) =>
                  `'${(vals[idx] || '').replace(/'/g, "''")}'`,
              );
              let colsStr = this._csvData.headers
                .map((h: string) => `"${h}"`)
                .join(', ');
              await conn.query(
                `INSERT INTO ${tableName} (${colsStr}) VALUES (${cleanVals.join(', ')})`,
              );
            }
          }

          inserted += batchLines.length;
          this._panel.webview.postMessage({
            type: 'progress',
            data: `Inserted ${inserted} / ${total} rows...`,
          });
        }

        this._panel.webview.postMessage({
          type: 'progress',
          data: 'Import complete!',
        });
        this._panel.webview.postMessage({ type: 'done' });
        vscode.window.showInformationMessage(
          `Successfully imported ${inserted} rows into ${tableName}.`,
        );
        vscode.commands.executeCommand(
          'sqlnotebook.refreshConnection',
          this._config,
        );

        setTimeout(() => this._panel.dispose(), 2000);
      } finally {
        conn.release();
      }
    } catch (e: any) {
      this._panel.webview.postMessage({ type: 'error' });
      vscode.window.showErrorMessage(`Import failed: ${e.message}`);
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
        'import-bundle.js',
      ),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Import Wizard</title>
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
