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
    vscode.workspace.registerNotebookSerializer(
      notebookType,
      new SQLSerializer()
    )
  );

  const connectionsSidepanel = new SQLNotebookConnections(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'sqlnotebook-connections',
      connectionsSidepanel
    )
  );

  activateFormProvider(context);

  const kernelManager = new KernelManager(context);
  context.subscriptions.push({ dispose: () => kernelManager.dispose() });

  const completionProvider = new SqlCompletionItemProvider(kernelManager);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'sql',
      completionProvider,
      '.', ' '
    )
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
}

export function deactivate() {
}