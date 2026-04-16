import * as vscode from 'vscode';
import {
  ConnData,
  ConnectionListItem,
  SQLNotebookConnections,
  TableItem
} from './connections';
import { globalFormProvider } from './form';

export function deleteConnectionConfiguration(
  context: vscode.ExtensionContext,
  connectionsSidepanel: SQLNotebookConnections
) {
  return async (item: ConnectionListItem) => {
    const config = vscode.workspace.getConfiguration('sqlnotebook');
    const current = config.get<ConnData[]>('connections') || [];
    const without = current.filter(({ name }) => name !== item.config.name);

    await config.update('connections', without, vscode.ConfigurationTarget.Global);
    if (item.config.driver !== 'sqlite' && item.config.passwordKey) {
      await context.secrets.delete(item.config.passwordKey);
    }

    connectionsSidepanel.refresh();
    vscode.window.showInformationMessage(`Deleted connection "${item.config.name}"`);
  };
}

export function editConnectionConfiguration(
  context: vscode.ExtensionContext
) {
  return async (item: ConnectionListItem) => {
    if (globalFormProvider) {
        globalFormProvider.editConnection(item.config);
    } else {
        vscode.window.showErrorMessage("Form provider not available.");
    }
  };
}

export function scriptSelectTop() {
  return async (item: TableItem) => {
    const driver = item.config.driver;
    const schema = item.tableSchema.schema;
    const table = item.tableSchema.table;

    let fullTableName = schema ? `${schema}.${table}` : table;
    let query = driver === 'mssql'
      ? `SELECT TOP 100 * FROM ${fullTableName};`
      : `SELECT * FROM ${fullTableName} LIMIT 100;`;

    const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, query, 'sql');
    const nbData = new vscode.NotebookData([cellData]);
    const doc = await vscode.workspace.openNotebookDocument('sql-notebook', nbData);
    await vscode.window.showNotebookDocument(doc);
  };
}