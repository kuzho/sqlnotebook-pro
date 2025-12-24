import * as vscode from 'vscode';
import { ConnData } from './connections';
import { getPool, Pool, ExecutionResult, PoolConfig, TableSchema } from './driver';
import { notebookType } from './main';

export class KernelManager {
  public controllers = new Map<string, SQLNotebookKernel>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.refresh();
  }

  refresh() {
    const connections = vscode.workspace.getConfiguration('sqlnotebook').get<ConnData[]>('connections') || [];
    const currentNames = new Set(connections.map(c => c.name));

    for (const [name, kernel] of this.controllers) {
      if (!currentNames.has(name)) {
        kernel.dispose();
        this.controllers.delete(name);
      }
    }

    for (const conn of connections) {
      if (this.controllers.has(conn.name)) {
        this.controllers.get(conn.name)!.updateConfiguration(conn);
      } else {
        const kernel = new SQLNotebookKernel(conn, this.context);
        this.controllers.set(conn.name, kernel);
      }
    }
  }

  dispose() {
    for (const kernel of this.controllers.values()) {
      kernel.dispose();
    }
    this.controllers.clear();
  }
}

export class SQLNotebookKernel {
  readonly id: string;
  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;
  private pool: Pool | null = null;
  private config: ConnData;
  private schemaCache: TableSchema[] | null = null;

  constructor(initialConfig: ConnData, private readonly context: vscode.ExtensionContext) {
    this.config = initialConfig;
    this.id = `sql-notebook-${this.config.name}`;
    this._controller = vscode.notebooks.createNotebookController(this.id, notebookType, this.config.name);
    this._controller.supportedLanguages = ['sql'];
    this._controller.supportsExecutionOrder = true;
    this.updateDescription();
    this._controller.executeHandler = this._execute.bind(this);
  }

  public updateConfiguration(newConfig: ConnData) {
    this.config = newConfig;
    this.updateDescription();

    if (this.pool) {
      console.log(`[SQL Notebook] Recycling connection for:: ${this.config.name}`);
      this.pool.end();
      this.pool = null;
    }
    this.schemaCache = null;
  }

  public async getSchemaOrLoad(): Promise<TableSchema[]> {
    if (this.schemaCache) return this.schemaCache;

    try {
        const pool = await this.getPool();
        this.schemaCache = await pool.getSchema();
        return this.schemaCache;
    } catch (e) {
        console.error("Error loading schema for autocomplete", e);
        return [];
    }
  }

  private updateDescription() {
    this._controller.description = this.config.driver;
    if (this.config.driver === 'sqlite') {
       this._controller.detail = this.config.path;
    } else {
       this._controller.detail = `${this.config.user}@${this.config.host}:${this.config.port}`;
    }
  }

  dispose() {
    this._controller.dispose();
    if (this.pool) {
      this.pool.end();
      this.pool = null;
    }
  }

  private async _execute(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): Promise<void> {
    for (let cell of cells) {
      await this.doExecution(cell);
    }

    if (!this.schemaCache) {
       this.getSchemaOrLoad().then(() => console.log('Schema pre-fetched after execution'));
    }
  }

  private async getPool(): Promise<Pool> {
    if (this.pool) return this.pool;
    let password = this.config.password;
    if (!password && this.config.driver !== 'sqlite') {
      try {
        password = (await this.context.secrets.get(this.config.passwordKey)) || undefined;
      } catch (e) {}
    }

    const poolConfig = {
      ...this.config,
      password,
      queryTimeout: vscode.workspace.getConfiguration('SQLNotebook').get('queryTimeout') ?? 30000
    } as PoolConfig;

    this.pool = await getPool(poolConfig);
    return this.pool;
  }

  private async doExecution(cell: vscode.NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    const rawQuery = cell.document.getText();
    if (!rawQuery.trim()) {
      const emptyMsg = [{
        Status: '⚠️ Info',
        Message: 'Empty cell - No query found'
      }];
      const myMimeType = 'application/vnd.code-sql-notebook.table+json';
      writeSuccess(execution, [[vscode.NotebookCellOutputItem.json(emptyMsg, myMimeType)]]);
      return;
    }

    let conn;
    try {
      const pool = await this.getPool();
      conn = await pool.getConnection();
    } catch (err: any) {
      writeErr(execution, `Connection Error: ${err.message || err}`);
      return;
    }

    execution.token.onCancellationRequested(() => {
      conn.release();
      conn.destroy();
      writeErr(execution, 'Query cancelled by user');
    });

    let result: ExecutionResult;
    try {
      result = await conn.query(rawQuery);
      conn.release();
    } catch (err: any) {
      writeErr(execution, err.message || String(err));
      conn.release();
      return;
    }

    if (typeof result === 'string') {
      writeSuccess(execution, [[text(result)]]);
      return;
    }

    if (result.length === 0 || (result.length === 1 && result[0].length === 0)) {
      const emptyMsg = [{ Status: 'Success', Message: 'Query executed. No rows returned.' }];
      const myMimeType = 'application/vnd.code-sql-notebook.table+json';
      writeSuccess(execution, [[vscode.NotebookCellOutputItem.json(emptyMsg, myMimeType)]]);
      return;
    }

    const maxRows = vscode.workspace.getConfiguration('SQLNotebook').get<number>('maxResultRows') || 100;

    writeSuccess(
      execution,
      result.map((item) => {
        const isTruncated = item.length > maxRows;
        const displayData = isTruncated ? item.slice(0, maxRows) : item;
        const outputs: vscode.NotebookCellOutputItem[] = [];
        const myMimeType = 'application/vnd.code-sql-notebook.table+json';
        outputs.push(vscode.NotebookCellOutputItem.json(displayData, myMimeType));

        return outputs;
      })
    );
  }
}

function writeErr(execution: vscode.NotebookCellExecution, err: string) {
const errorData = [{
    Status: '❌ Error',
    Message: err
  }];

  const myMimeType = 'application/vnd.code-sql-notebook.table+json';

  execution.replaceOutput([
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.json(errorData, myMimeType),
      vscode.NotebookCellOutputItem.text(err)
    ])
  ]);
  execution.end(false, Date.now());
}

const { text } = vscode.NotebookCellOutputItem;

function writeSuccess(execution: vscode.NotebookCellExecution, outputs: vscode.NotebookCellOutputItem[][]) {
  execution.replaceOutput(outputs.map((items) => new vscode.NotebookCellOutput(items)));
  execution.end(true, Date.now());
}