import * as vscode from 'vscode';

export function handleExecutionError(execution: vscode.NotebookCellExecution, err: any, message: string = 'Error executing query') {
    execution.replaceOutput([
        new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.error(err)
        ])
    ]);
    execution.end(false, Date.now());
    console.error(`${message}:`, err);
}