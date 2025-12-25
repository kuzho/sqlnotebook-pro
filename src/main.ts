import * as vscode from 'vscode';
import { SQLNotebookConnections } from './connections';
import { deleteConnectionConfiguration, editConnectionConfiguration } from './commands';
import { activateFormProvider } from './form';
import { SQLSerializer } from './serializer';
import { KernelManager } from './controller';
import { SqlCompletionItemProvider } from './completion';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export const notebookType = 'sql-notebook';
export const storageKey = 'sqlnotebook-connections';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(notebookType, new SQLSerializer())
  );

  const connectionsSidepanel = new SQLNotebookConnections(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sqlnotebook-connections', connectionsSidepanel)
  );

  vscode.commands.executeCommand('setContext', 'sqlnotebook.allCollapsed', false);

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlnotebook.collapseAll', async () => {
      await vscode.commands.executeCommand('notebook.cell.collapseAllCellInputs');
      await vscode.commands.executeCommand('setContext', 'sqlnotebook.allCollapsed', true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlnotebook.expandAll', async () => {
      await vscode.commands.executeCommand('notebook.cell.expandAllCellInputs');
      await vscode.commands.executeCommand('setContext', 'sqlnotebook.allCollapsed', false);
    })
  );

  const messaging = vscode.notebooks.createRendererMessaging('sqlnotebook-pro-interactive-renderer');
  context.subscriptions.push(
    messaging.onDidReceiveMessage(async ({ message }) => {
      if (message.type === 'export_data') {
        await handleExport(message.payload);
      }
    })
  );

  activateFormProvider(context);

  const kernelManager = new KernelManager(context);
  context.subscriptions.push({ dispose: () => kernelManager.dispose() });

  const completionProvider = new SqlCompletionItemProvider(kernelManager);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('sql', completionProvider, '.', ' ')
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlnotebook.refreshKernels', () => {
      kernelManager.refresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('sqlnotebook.connections')) {
          kernelManager.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'sqlnotebook.deleteConnectionConfiguration',
      deleteConnectionConfiguration(context, connectionsSidepanel)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'sqlnotebook.editConnection',
      editConnectionConfiguration(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlnotebook.refreshConnectionPanel', () => {
      connectionsSidepanel.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'sqlnotebook.expandCell',
      async (cell: vscode.NotebookCell) => {
        const editor = vscode.window.activeNotebookEditor;
        if (!editor || !cell) return;
        const range = new vscode.NotebookRange(cell.index, cell.index + 1);
        editor.selection = range;
        editor.revealRange(range);
        await new Promise(r => setTimeout(r, 0));
        await vscode.commands.executeCommand('notebook.cell.expandCellInput');
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'sqlnotebook.collapseCell',
      async (cell: vscode.NotebookCell) => {
        const editor = vscode.window.activeNotebookEditor;
        if (!editor || !cell) return;
        const range = new vscode.NotebookRange(cell.index, cell.index + 1);
        editor.selection = range;
        editor.revealRange(range);
        await new Promise(r => setTimeout(r, 0));
        await vscode.commands.executeCommand('notebook.cell.collapseCellInput');
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlnotebook.moveCellUp', async (cell: vscode.NotebookCell) => {
      if (cell) {
        const editor = vscode.window.activeNotebookEditor;
        if (editor) {
            const range = new vscode.NotebookRange(cell.index, cell.index + 1);
            editor.selection = range;
            editor.revealRange(range);
        }
      }
      await vscode.commands.executeCommand('notebook.cell.moveUp');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlnotebook.moveCellDown', async (cell: vscode.NotebookCell) => {
      if (cell) {
        const editor = vscode.window.activeNotebookEditor;
        if (editor) {
            const range = new vscode.NotebookRange(cell.index, cell.index + 1);
            editor.selection = range;
            editor.revealRange(range);
        }
      }
      await vscode.commands.executeCommand('notebook.cell.moveDown');
    })
  );
}

async function handleExport({ data, format }: { data: any[], format: 'csv' | 'xlsx' }) {
  if (!data || data.length === 0) {
    vscode.window.showWarningMessage('No data to export.');
    return;
  }
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  const defaultFilename = `Results_${dateStr}.${format}`;

  let defaultUri: vscode.Uri;
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      defaultUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultFilename);
  } else {
      defaultUri = vscode.Uri.file(path.join(os.homedir(), 'Downloads', defaultFilename));
  }

  const filters = format === 'xlsx'
    ? { 'Excel files': ['xlsx'] }
    : { 'CSV files': ['csv'] };

  const uri = await vscode.window.showSaveDialog({
    saveLabel: 'Export',
    filters,
    defaultUri
  });

  if (!uri) return;

  try {
    const filePath = uri.fsPath;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");

    if (format === 'csv') {
      const csvContent = XLSX.utils.sheet_to_csv(ws);
      fs.writeFileSync(filePath, csvContent, 'utf8');
    } else {
      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
      fs.writeFileSync(filePath, buffer);
    }

    const openAfterExport = vscode.workspace.getConfiguration('SQLNotebook').get('openAfterExport');

    if (openAfterExport) {
      await vscode.env.openExternal(vscode.Uri.file(filePath));
    } else {
      const openBtn = 'Open File';
      vscode.window.showInformationMessage(`Successfully exported to ${path.basename(filePath)}`, openBtn)
        .then(selection => {
          if (selection === openBtn) {
            vscode.env.openExternal(vscode.Uri.file(filePath));
          }
        });
    }

  } catch (err: any) {
    if (err.code === 'EBUSY' || err.message.includes('busy')) {
        vscode.window.showErrorMessage(`Export failed: The file "${path.basename(uri.fsPath)}" is open in Excel. Please close it and try again.`);
    } else {
        vscode.window.showErrorMessage(`Export failed: ${err.message}`);
    }
  }
}

export function deactivate() {}