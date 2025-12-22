import * as vscode from 'vscode';
import {
  ConnData,
  ConnectionListItem,
  SQLNotebookConnections,
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
    await context.secrets.delete(item.config.name);

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