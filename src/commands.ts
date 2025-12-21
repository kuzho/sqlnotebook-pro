import * as vscode from 'vscode';
import {
  ConnData,
  ConnectionListItem,
  SQLNotebookConnections,
} from './connections';
import { getPool, PoolConfig } from './driver';
import { globalConnPool } from './main';
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

export function connectToDatabase(
  context: vscode.ExtensionContext,
  connectionsSidepanel: SQLNotebookConnections
) {
  return async (item?: ConnectionListItem) => {
    let selectedName: string;
    if (!item) {
      const names = vscode.workspace.getConfiguration('sqlnotebook').get<ConnData[]>('connections')!.map(({ name }) => name);
      const namePicked = await vscode.window.showQuickPick(names, {
        ignoreFocusOut: true,
      });
      if (!namePicked) {
        vscode.window.showErrorMessage(`Invalid database connection name.`);
        return;
      }
      selectedName = namePicked;
    } else {
      selectedName = item.config.name;
    }

    const match = vscode.workspace.getConfiguration('sqlnotebook').get<ConnData[]>('connections')!.find(({ name }) => name === selectedName);
    if (!match) {
      vscode.window.showErrorMessage(`"${selectedName}" not found.`);
      return;
    }

    let password: string | undefined;
    try {
      if (match.driver === 'sqlite') {
        globalConnPool.pool = await getPool({
          driver: 'sqlite',
          path: match.path,
        });
      } else {
        password = await context.secrets.get(match.passwordKey);
        if (password === undefined) {
          vscode.window.showWarningMessage(`Connection password not found.`);
        }

        globalConnPool.pool = await getPool({
          ...match,
          password,
          queryTimeout: getQueryTimeoutConfiguration(),
        } as PoolConfig);
      }

      const conn = await globalConnPool.pool.getConnection();
      await conn.query('SELECT 1');
      conn.release();


      vscode.window.showInformationMessage(`Successfully connected to "${match.name}"`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to connect: ${(err as { message: string }).message}`);
      globalConnPool.pool = null;
    }
  };
}

function getQueryTimeoutConfiguration(): number {
  return vscode.workspace.getConfiguration('SQLNotebook').get('queryTimeout') ?? 30000;
}