import * as vscode from 'vscode';
import { ConnData } from './connections';
import { getPool, Pool, ExecutionResult, PoolConfig, TableSchema } from './driver';
import { ParameterProvider } from './ParameterProvider';
import { notebookType } from './main';
import { splitSqlBatches } from './utils/sqlUtils';

export class KernelManager {
  public controllers = new Map<string, SQLNotebookKernel>();
  private selectedKernelByNotebook = new Map<string, SQLNotebookKernel>();
  private selectionDisposablesByKernel = new Map<string, vscode.Disposable>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly parameterProvider: ParameterProvider
  ) {
    this.refresh();
  }

  refresh() {
    const connections = vscode.workspace.getConfiguration('sqlnotebook').get<ConnData[]>('connections') || [];
    const currentNames = new Set(connections.map(c => c.name));

    for (const [name, kernel] of this.controllers) {
      if (!currentNames.has(name)) {
        const selectionDisposable = this.selectionDisposablesByKernel.get(name);
        if (selectionDisposable) {
          selectionDisposable.dispose();
          this.selectionDisposablesByKernel.delete(name);
        }
        for (const [uri, mappedKernel] of this.selectedKernelByNotebook.entries()) {
          if (mappedKernel === kernel) {
            this.selectedKernelByNotebook.delete(uri);
          }
        }
        kernel.dispose();
        this.controllers.delete(name);
      }
    }

    for (const conn of connections) {
      if (this.controllers.has(conn.name)) {
        this.controllers.get(conn.name)!.updateConfiguration(conn);
      } else {
        const kernel = new SQLNotebookKernel(conn, this.context, this.parameterProvider);
        this.controllers.set(conn.name, kernel);
        const selectionDisposable = kernel.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
          const uri = notebook.uri.toString();
          if (selected) {
            this.selectedKernelByNotebook.set(uri, kernel);
          } else if (this.selectedKernelByNotebook.get(uri) === kernel) {
            this.selectedKernelByNotebook.delete(uri);
          }
        });
        this.selectionDisposablesByKernel.set(conn.name, selectionDisposable);
      }
    }
  }

  dispose() {
    for (const kernel of this.controllers.values()) {
      kernel.dispose();
    }
    this.controllers.clear();
    for (const disposable of this.selectionDisposablesByKernel.values()) {
      disposable.dispose();
    }
    this.selectionDisposablesByKernel.clear();
    this.selectedKernelByNotebook.clear();
  }

  public getDriverForNotebook(notebook: vscode.NotebookDocument | undefined): ConnData['driver'] | undefined {
    if (!notebook) { return undefined; }
    const uri = notebook.uri.toString();
    const kernel = this.selectedKernelByNotebook.get(uri);
    if (kernel) { return kernel.getDriver(); }
    if (this.controllers.size === 1) {
      return [...this.controllers.values()][0].getDriver();
    }
    return undefined;
  }

  public getKernelForNotebook(notebook: vscode.NotebookDocument | undefined): SQLNotebookKernel | undefined {
    if (!notebook) { return undefined; }
    const uri = notebook.uri.toString();
    const kernel = this.selectedKernelByNotebook.get(uri);
    if (kernel) { return kernel; }
    if (this.controllers.size === 1) {
      return [...this.controllers.values()][0];
    }
    return undefined;
  }

  public async runBackgroundQuery(notebookUri: string, sql: string): Promise<void> {
    const kernel = this.selectedKernelByNotebook.get(notebookUri);
    if (kernel) {
      await kernel.runBackground(sql);
    } else if (this.controllers.size === 1) {
      await [...this.controllers.values()][0].runBackground(sql);
    } else {
      throw new Error("No active database connection selected.");
    }
  }
}

export class SQLNotebookKernel {
  readonly id: string;
  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;
  private pool: Pool | null = null;
  private config: ConnData;
  private schemaCache: TableSchema[] | null = null;

  constructor(
    initialConfig: ConnData,
    private readonly context: vscode.ExtensionContext,
    private readonly parameterProvider: ParameterProvider
  ) {
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
    if (this.schemaCache) { return this.schemaCache; }

    const autoFetch = vscode.workspace.getConfiguration('sqlnotebook').get<boolean>('autoFetchSchema') ?? true;
    if (!autoFetch) { return []; }

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
    this._controller.label = this.config.group ? `${this.config.group} / ${this.config.name}` : this.config.name;
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

  public getDriver(): ConnData['driver'] {
    return this.config.driver;
  }

  public onDidChangeSelectedNotebooks(
    listener: (e: { notebook: vscode.NotebookDocument; selected: boolean }) => any
  ): vscode.Disposable {
    return this._controller.onDidChangeSelectedNotebooks(listener);
  }

  public async runBackground(sql: string): Promise<void> {
    const pool = await this.getPool();
    const conn = await pool.getConnection();
    try {
      await conn.query(sql);
      vscode.window.showInformationMessage('✅ Changes saved successfully to the database!');
    } catch (err: any) {
      vscode.window.showErrorMessage(`❌ Error saving changes: ${err.message}`);
      throw err;
    } finally {
      conn.release();
    }
  }

  private async _execute(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): Promise<void> {
    this.parameterProvider.notifyQueryExecutionStart();
    for (let cell of cells) {
      await this.doExecution(cell);
    }

    if (!this.schemaCache) {
       const autoFetch = vscode.workspace.getConfiguration('sqlnotebook').get<boolean>('autoFetchSchema') ?? true;
       if (autoFetch) {
          this.getSchemaOrLoad().then(() => console.log('Schema pre-fetched after execution'));
       }
    }
  }

  private async getPool(): Promise<Pool> {
    if (this.pool) { return this.pool; }
    let password = (this.config as any).password;
    if (!password && this.config.driver !== 'sqlite') {
      try {
        password = (await this.context.secrets.get(this.config.passwordKey)) || undefined;
      } catch (e) {}
    }

    let timeoutSeconds = vscode.workspace.getConfiguration('sqlnotebook').get<number>('queryTimeout') ?? 60;

    const poolConfig = {
      ...this.config,
      password,
      queryTimeout: timeoutSeconds * 1000
    } as PoolConfig;

    this.pool = await getPool(poolConfig);
    return this.pool;
  }

  private async doExecution(cell: vscode.NotebookCell): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());
    await execution.clearOutput();

    let rawQuery = cell.document.getText();

    const PARAMS_REGEX = /\/\*\s*<SQL_PARAMS>\s*([\s\S]*?)\s*<\/SQL_PARAMS>\s*\*\//;
    rawQuery = rawQuery.replace(PARAMS_REGEX, '').trim();

    const params = this.parameterProvider.getParameters(cell.notebook.uri.toString());

    for (const [key, param] of Object.entries(params)) {
      if (param && typeof param === 'object' && param.required) {
        const { value } = resolveParameter(param as StoredParameterValue);
        if (!value || value.trim() === '') {
          const paramName = key.startsWith('@') ? key : `@${key}`;
          const searchPattern = new RegExp(`(?<!@)${paramName}\\b`, 'i');
          if (searchPattern.test(rawQuery)) {
             const errMsg = `Validation Error: Parameter '${paramName}' is required but was left empty.`;
             await writeErr(execution, errMsg);
             return;
          }
        }
      }
    }

    const batches = splitSqlBatches(rawQuery);
    const safeDelete = vscode.workspace.getConfiguration('sqlnotebook').get('safeDelete') ?? true;

    for (let batch of batches) {
      if (execution.token.isCancellationRequested) {
        execution.end(undefined, undefined);
        return;
      }

      try {
        Object.keys(params).forEach(key => {
          const param = params[key] as StoredParameterValue;
          const { value, raw } = resolveParameter(param);

          const paramName = key.startsWith('@') ? key : `@${key}`;
          const searchPattern = new RegExp(`(?<!@)${paramName}\\b`, 'g');

          if (raw) {
            batch = batch.replace(searchPattern, value);
          } else {
            batch = batch.replace(searchPattern, formatParameterValue(value));
          }
        });

        const strippedBatch = batch.replace(/--.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');

        if (safeDelete) {
           const isDelete = /\bDELETE\b/i.test(strippedBatch);
           const isUpdate = /\bUPDATE\b/i.test(strippedBatch);
           if ((isDelete || isUpdate) && !/\bWHERE\b/i.test(strippedBatch)) {
              const cmd = isDelete ? 'DELETE' : 'UPDATE';
              const errMsg = `Safety Alert: ${cmd} statement without WHERE clause detected. Execution blocked.\nYou can disable this protection in Settings: 'SQL Notebook: Safe Delete'.`;
              vscode.window.showErrorMessage(`Safety Alert: ${cmd} without WHERE blocked.`);
              await writeErr(execution, errMsg);
              return;
           }
        }

        const pool = await this.getPool();
        const conn = await pool.getConnection();

        const cancelListener = execution.token.onCancellationRequested(() => {
          try { conn.destroy(); } catch (e) {}
        });

        let result: ExecutionResult;
        try {
          result = await conn.query(batch);

          if (/\b(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(strippedBatch)) {
            this.schemaCache = null;
          }
        } finally {
          cancelListener.dispose();
          conn.release();
        }

        await this.appendExecutionResult(execution, result || [], batch);

      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Query Execution Error: ${errorMessage}`);
        await writeErr(execution, errorMessage);
        return;
      }
    }

    execution.end(true, Date.now());
  }

  private async appendExecutionResult(execution: vscode.NotebookCellExecution, result: ExecutionResult, query: string): Promise<void> {
    const now = new Date();
    const newOutputs: vscode.NotebookCellOutput[] = [];
    const maxRows = vscode.workspace.getConfiguration('sqlnotebook').get<number>('maxResultRows') ?? 10000;

    const tableMatch = query.match(/\bFROM\s+([#\w.\[\]"`]+)/i) || query.match(/\bUPDATE\s+([#\w.\[\]"`]+)/i) || query.match(/\bINSERT\s+INTO\s+([#\w.\[\]"`]+)/i);
    const tableName = tableMatch ? tableMatch[1] : undefined;

    let primaryKeys: string[] | undefined;
    if (tableName && this.schemaCache) {
      const cleanTableName = tableName.replace(/[\[\]"`]/g, '').split('.').pop();
      const tableMeta = this.schemaCache.find(t => t.table.toLowerCase() === cleanTableName?.toLowerCase());
      if (tableMeta && tableMeta.primaryKeys && tableMeta.primaryKeys.length > 0) {
        primaryKeys = tableMeta.primaryKeys;
      }
    }

    for (const res of result) {
      let rows = Array.isArray(res) ? res : res.rows;
      const columns = Array.isArray(res) ? undefined : res.columns;
      let truncated = false;
      const originalLength = rows?.length || 0;

      if (rows && rows.length > maxRows) {
        rows = rows.slice(0, maxRows);
        truncated = true;
      }

      if (rows && rows.length > 0) {
        const info = makeExecutionInfo(now) as any;
        if (truncated) { info.truncated = true; info.originalLength = originalLength; }
        if (tableName) { info.tableName = tableName; }
        if (primaryKeys) { info.primaryKeys = primaryKeys; }
        newOutputs.push(new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.json({ rows, columns, info }, 'application/vnd.code-sql-notebook.table+json'),
          vscode.NotebookCellOutputItem.json(rows, 'application/json')
        ]));
      }
    }

    if (newOutputs.length === 0) {
      const isSelect = /^\s*select/i.test(query);
      const msg = isSelect ? 'Query executed successfully, 0 rows returned.' : 'Command(s) completed successfully.';
      newOutputs.push(new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.json({
          rows: [{ Status: 'Success', Message: msg }],
          info: makeExecutionInfo(now)
        }, 'application/vnd.code-sql-notebook.table+json'),
        vscode.NotebookCellOutputItem.text(msg)
      ]));
    }

    await execution.appendOutput(newOutputs);
  }
}

type StoredParameterType = 'text' | 'checkbox' | 'select' | 'date';

type StoredParameterValue = string | {
  value?: string;
  raw?: boolean;
  type?: StoredParameterType;
  options?: string[];
  checked?: boolean;
  checkedValue?: string;
  uncheckedValue?: string;
  required?: boolean;
};

function resolveParameter(param: StoredParameterValue): { value: string; raw: boolean } {
  if (typeof param === 'string') {
    return { value: param, raw: false };
  }

  if (!param || typeof param !== 'object') {
    return { value: '', raw: false };
  }

  const type = param.type === 'checkbox' || param.type === 'select' || param.type === 'date' ? param.type : 'text';
  const raw = !!param.raw;

  if (type === 'checkbox') {
    const checked = !!param.checked;
    const checkedValue = String(param.checkedValue ?? 'true');
    const uncheckedValue = String(param.uncheckedValue ?? 'false');
    return { value: checked ? checkedValue : uncheckedValue, raw };
  }

  if (type === 'select') {
    const options = Array.isArray(param.options) ? param.options.map(v => String(v)) : [];
    const selected = String(param.value ?? '');
    return { value: selected || options[0] || '', raw };
  }

  if (type === 'date') {
    return { value: String(param.value ?? ''), raw };
  }

  return { value: String(param.value ?? ''), raw };
}

function formatParameterValue(value: string): string {
  const trimmedValue = value.trim();

  const processItem = (item: string): string => {
    const trimmedItem = item.trim();
    const isQuotedByUser = (trimmedItem.startsWith("'") && trimmedItem.endsWith("'")) || (trimmedItem.startsWith('"') && trimmedItem.endsWith('"'));
    let cleanItem = isQuotedByUser ? trimmedItem.slice(1, -1) : trimmedItem;

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cleanItem)) {
      cleanItem = cleanItem.replace('T', ' ');
    }

    return `'${cleanItem.replace(/'/g, "''")}'`;
  };

  const matches = trimmedValue.match(/('[^']*'|"[^"]*"|[^,]+)/g);
  if (!matches || matches.length === 0) {
    return "''";
  }
  return matches.map(processItem).join(',');
}

async function writeErr(execution: vscode.NotebookCellExecution, err: string) {
  const now = new Date();
  const errorData = [{
      Status: '❌ Error',
      Message: err
  }];

  const myMimeType = 'application/vnd.code-sql-notebook.table+json';

  const outputData = {
      rows: errorData,
      info: makeExecutionInfo(now)
  };

  await execution.appendOutput([
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.json(outputData, myMimeType),
      vscode.NotebookCellOutputItem.text(err)
    ])
  ]);
  execution.end(false, Date.now());
}

function makeExecutionInfo(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const executionTime = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const executionDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const config = vscode.workspace.getConfiguration('sqlnotebook');
  const badgeKeywords = {
    danger: config.get<string>('badgeKeywordsDanger', '🔴, atrasada, failed, fail, error, critical, cancelado, cancelled, rechazado, rejected, timeout').split(',').map(s => s.trim()).filter(Boolean),
    warning: config.get<string>('badgeKeywordsWarning', '🟡, urgente, warning, pending, en pausa, paused, en espera, waiting, delayed, demorado').split(',').map(s => s.trim()).filter(Boolean),
    success: config.get<string>('badgeKeywordsSuccess', '🟢, a tiempo, success, ready, ok, completed, done, activo, active, terminado, finished, aprobado, approved, entregado').split(',').map(s => s.trim()).filter(Boolean),
    inactive: config.get<string>('badgeKeywordsInactive', '⚪, sin fecha, inactive, null, none, cerrado, closed, disabled, desactivado, archived, archivado, n/a, empty').split(',').map(s => s.trim()).filter(Boolean),
    processing: config.get<string>('badgeKeywordsProcessing', '🔵, processing, running, en progreso, in progress, en proceso, started, iniciado, cargando, loading').split(',').map(s => s.trim()).filter(Boolean)
  };

  return {
    executionTime,
    executionDate,
    executionId: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 9),
    badgeKeywords
  };
}