import * as vscode from 'vscode';
import { SQLNotebookConnections } from './connections';
import { deleteConnectionConfiguration, editConnectionConfiguration } from './commands';
import { activateFormProvider } from './form';
import { SQLSerializer } from './serializer';
import { KernelManager } from './controller';
import { SqlCompletionItemProvider } from './completion';

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

        await vscode.commands.executeCommand(
          'notebook.cell.expandCellInput'
        );
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

        await vscode.commands.executeCommand(
          'notebook.cell.collapseCellInput'
        );
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

export function deactivate() {}