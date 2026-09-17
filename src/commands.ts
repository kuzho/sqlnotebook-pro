import * as vscode from 'vscode';
import {
  ConnData,
  ConnectionListItem,
  SQLNotebookConnections,
  TableItem,
  ViewItem,
  ColumnItem,
} from './connections';
import { globalFormProvider } from './form';
import { getPool, PoolConfig } from './driver';

export function deleteConnectionConfiguration(
  context: vscode.ExtensionContext,
  connectionsSidepanel: SQLNotebookConnections,
) {
  return async (item: ConnectionListItem) => {
    const config = vscode.workspace.getConfiguration('sqlnotebook');
    const current = config.get<ConnData[]>('connections') || [];
    const without = current.filter(({ name }) => name !== item.config.name);
    await config.update(
      'connections',
      without,
      vscode.ConfigurationTarget.Global,
    );
    if (item.config.driver !== 'sqlite' && item.config.passwordKey) {
      await context.secrets.delete(item.config.passwordKey);
    }
    connectionsSidepanel.refresh();
    vscode.window.showInformationMessage(
      `Deleted connection "${item.config.name}"`,
    );
  };
}

export function editConnectionConfiguration(context: vscode.ExtensionContext) {
  return async (item: ConnectionListItem) => {
    if (globalFormProvider) {
      globalFormProvider.editConnection(item.config);
    } else {
      vscode.window.showErrorMessage('Form provider not available.');
    }
  };
}

export function testConnectionConfiguration(context: vscode.ExtensionContext) {
  return async (item: ConnectionListItem) => {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Testing connection "${item.config.name}"...`,
        cancellable: false,
      },
      async () => {
        const startTime = Date.now();
        try {
          let password = (item.config as any).password;
          if (!password && item.config.driver !== 'sqlite') {
            try {
              password = await context.secrets.get(item.config.passwordKey);
            } catch (e) {}
          }
          const poolConfig = {
            ...item.config,
            password,
            queryTimeout: 10000,
          } as PoolConfig;
          const pool = await getPool(poolConfig);
          let schemaObjCount = 0;
          try {
            const schema = await pool.getSchema();
            schemaObjCount = schema.length;
          } finally {
            try {
              pool.end();
            } catch (e) {}
          }
          const elapsed = Date.now() - startTime;
          vscode.window.showInformationMessage(
            `⚡ Connection "${item.config.name}" successful (${elapsed}ms)! Found ${schemaObjCount} schema objects.`,
          );
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `❌ Connection "${item.config.name}" failed: ${err.message || err}`,
          );
        }
      },
    );
  };
}

export function duplicateConnectionConfiguration(
  connectionsSidepanel: SQLNotebookConnections,
) {
  return async (item: ConnectionListItem) => {
    const config = vscode.workspace.getConfiguration('sqlnotebook');
    const current = config.get<ConnData[]>('connections') || [];
    const newName = `${item.config.name} (Copy)`;
    const copyConfig = { ...item.config, name: newName };
    await config.update(
      'connections',
      [...current, copyConfig],
      vscode.ConfigurationTarget.Global,
    );
    connectionsSidepanel.refresh();
    vscode.window.showInformationMessage(
      `Duplicated connection as "${newName}"`,
    );
  };
}

import { KernelManager } from './controller';

export function scriptSelectTop(kernelManager: KernelManager) {
  return async (item: TableItem | ViewItem) => {
    const driver = item.config.driver;
    const schema = item.tableSchema.schema;
    const table = item.tableSchema.table;
    const fullTableName = schema ? `${schema}.${table}` : table;
    const query =
      driver === 'mssql'
        ? `SELECT TOP 100 * FROM ${fullTableName};`
        : `SELECT * FROM ${fullTableName} LIMIT 100;`;
    const cellData = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      query,
      'sql',
    );
    const nbData = new vscode.NotebookData([cellData]);
    const doc = await vscode.workspace.openNotebookDocument(
      'sql-notebook',
      nbData,
    );
    if (item.config?.name) {
      kernelManager.bindNotebookToConnection(doc, item.config.name);
    }
    await vscode.window.showNotebookDocument(doc);
  };
}

export function scriptCountRows(kernelManager: KernelManager) {
  return async (item: TableItem | ViewItem) => {
    const schema = item.tableSchema.schema;
    const table = item.tableSchema.table;
    const fullTableName = schema ? `${schema}.${table}` : table;
    const query = `SELECT COUNT(*) AS TotalRows FROM ${fullTableName};`;
    const cellData = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      query,
      'sql',
    );
    const nbData = new vscode.NotebookData([cellData]);
    const doc = await vscode.workspace.openNotebookDocument(
      'sql-notebook',
      nbData,
    );
    if (item.config?.name) {
      kernelManager.bindNotebookToConnection(doc, item.config.name);
    }
    await vscode.window.showNotebookDocument(doc);
  };
}

export function scriptCreate(kernelManager: KernelManager) {
  return async (item: TableItem | ViewItem) => {
    const schema = item.tableSchema.schema;
    const table = item.tableSchema.table;
    const fullTableName = schema ? `${schema}.${table}` : table;
    
    let query = '';
    if (item.tableSchema.type === 'view') {
      query = `-- Definition of view ${fullTableName}\nCREATE VIEW ${fullTableName} AS\nSELECT * FROM ...; -- (Modify this)`;
    } else {
      const columns = item.tableSchema.columns || [];
      const colDefs = columns.map(col => {
        const type = item.tableSchema.columnTypes?.[col] || 'VARCHAR(255)';
        const isPk = item.tableSchema.primaryKeys?.includes(col);
        return `    ${col} ${type}${isPk ? ' PRIMARY KEY' : ''}`;
      });
      query = `CREATE TABLE ${fullTableName} (\n${colDefs.join(',\n')}\n);`;
    }

    const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, query, 'sql');
    const nbData = new vscode.NotebookData([cellData]);
    const doc = await vscode.workspace.openNotebookDocument('sql-notebook', nbData);
    if (item.config?.name) {
      kernelManager.bindNotebookToConnection(doc, item.config.name);
    }
    await vscode.window.showNotebookDocument(doc);
  };
}

export function scriptDrop(kernelManager: KernelManager) {
  return async (item: TableItem | ViewItem) => {
    const schema = item.tableSchema.schema;
    const table = item.tableSchema.table;
    const fullTableName = schema ? `${schema}.${table}` : table;
    const isView = item.tableSchema.type === 'view';
    const keyword = isView ? 'VIEW' : 'TABLE';
    
    const query = `DROP ${keyword} IF EXISTS ${fullTableName};`;
    const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, query, 'sql');
    const nbData = new vscode.NotebookData([cellData]);
    const doc = await vscode.workspace.openNotebookDocument('sql-notebook', nbData);
    if (item.config?.name) {
      kernelManager.bindNotebookToConnection(doc, item.config.name);
    }
    await vscode.window.showNotebookDocument(doc);
  };
}

export function scriptInsert(kernelManager: KernelManager) {
  return async (item: TableItem) => {
    const schema = item.tableSchema.schema;
    const table = item.tableSchema.table;
    const fullTableName = schema ? `${schema}.${table}` : table;
    const columns = item.tableSchema.columns || [];
    const placeholders = columns.map(() => '?').join(', ');
    
    const query = `INSERT INTO ${fullTableName} (${columns.join(', ')}) \nVALUES (${placeholders});`;
    const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, query, 'sql');
    const nbData = new vscode.NotebookData([cellData]);
    const doc = await vscode.workspace.openNotebookDocument('sql-notebook', nbData);
    if (item.config?.name) {
      kernelManager.bindNotebookToConnection(doc, item.config.name);
    }
    await vscode.window.showNotebookDocument(doc);
  };
}

export function newNotebookForConnection(kernelManager: KernelManager) {
  return async (item: ConnectionListItem) => {
    const cellData = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      '-- Write your SQL query here\n',
      'sql',
    );
    const nbData = new vscode.NotebookData([cellData]);
    const doc = await vscode.workspace.openNotebookDocument(
      'sql-notebook',
      nbData,
    );
    if (item.config?.name) {
      kernelManager.bindNotebookToConnection(doc, item.config.name);
    }
    await vscode.window.showNotebookDocument(doc);
  };
}

export function showExecutionPlan(kernelManager: KernelManager) {
  return async (cell: vscode.NotebookCell) => {
    if (cell && cell.kind === vscode.NotebookCellKind.Code) {
      await kernelManager.runExecutionPlan(cell);
    }
  };
}

export function copyObjectName() {
  return async (item: TableItem | ViewItem | ColumnItem | any) => {
    let nameToCopy = '';
    if (item instanceof TableItem || item instanceof ViewItem) {
      const schema = item.tableSchema.schema;
      nameToCopy = schema ? `${schema}.${item.tableSchema.table}` : item.tableSchema.table;
    } else if (item instanceof ColumnItem) {
      nameToCopy = item.columnName;
    } else if (item?.label) {
      nameToCopy = item.label.toString();
    }
    if (nameToCopy) {
      await vscode.env.clipboard.writeText(nameToCopy);
      vscode.window.showInformationMessage(`Copied "${nameToCopy}" to clipboard`);
    }
  };
}

export function insertIntoActiveCell() {
  return async (item: TableItem | ViewItem | ColumnItem | any) => {
    let textToInsert = '';
    if (item instanceof TableItem || item instanceof ViewItem) {
      const schema = item.tableSchema.schema;
      textToInsert = schema ? `${schema}.${item.tableSchema.table}` : item.tableSchema.table;
    } else if (item instanceof ColumnItem) {
      textToInsert = item.columnName;
    } else if (item?.label) {
      textToInsert = item.label.toString();
    }

    if (!textToInsert) return;

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.edit((builder) => {
        builder.insert(editor.selection.active, textToInsert);
      });
    } else {
      vscode.window.showWarningMessage('No active editor open to insert name.');
    }
  };
}

