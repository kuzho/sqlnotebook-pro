import * as vscode from 'vscode';
import { KernelManager } from './controller';

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'DROP', 'ALTER', 'INDEX', 'VIEW',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'ON',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'BETWEEN', 'LIKE', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'CONVERT'
];

export class SqlCompletionItemProvider implements vscode.CompletionItemProvider {
  constructor(private kernelManager: KernelManager) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {

    const keywordItems = SQL_KEYWORDS.map(k => {
        const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
        item.detail = 'SQL Keyword';
        return item;
    });

    const selectSnippet = new vscode.CompletionItem('SELECT * FROM', vscode.CompletionItemKind.Snippet);
    selectSnippet.insertText = new vscode.SnippetString('SELECT * FROM ${1:table_name} LIMIT 10;');
    selectSnippet.detail = "Snippet: Select All";

    const range = document.getWordRangeAtPosition(position);
    const textBefore = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));

    const matchTable = textBefore.match(/(\w+)\.$/);

    if (matchTable) {
        const tableName = matchTable[1];
        let foundColumns: string[] | undefined;
        let sourceTable = tableName;

        const notebook = vscode.workspace.notebookDocuments.find(nb =>
            nb.getCells().some(cell => cell.document === document)
        );
        const preferredName = notebook?.metadata?.custom?.connection;

        if (preferredName) {
            const kernel = this.kernelManager.controllers.get(preferredName);
            if (kernel) {
                const schema = await kernel.getSchemaOrLoad();
                const table = schema.find(t => t.table.toLowerCase() === tableName.toLowerCase());
                if (table) {
                    foundColumns = table.columns;
                    sourceTable = table.table;
                }
            }
        }

        if (!foundColumns) {
            for (const kernel of this.kernelManager.controllers.values()) {
                const schema = await kernel.getSchemaOrLoad();
                const table = schema.find(t => t.table.toLowerCase() === tableName.toLowerCase());
                if (table) {
                    foundColumns = table.columns;
                    sourceTable = table.table;
                    break;
                }
            }
        }

        if (foundColumns) {
            return foundColumns.map(col => {
                const item = new vscode.CompletionItem(col, vscode.CompletionItemKind.Field);
                item.detail = `Column of ${sourceTable}`;
                item.sortText = `0_${col}`;
                return item;
            });
        }
    }

    const allTables = new Map<string, vscode.CompletionItem>();

    for (const kernel of this.kernelManager.controllers.values()) {
        const schema = await kernel.getSchemaOrLoad();
        schema.forEach(t => {
            if (!allTables.has(t.table)) {
                const item = new vscode.CompletionItem(t.table, vscode.CompletionItemKind.Class);
                item.detail = `Table (${kernel.id.replace('sql-notebook-', '')})`;
                item.sortText = `1_${t.table}`;
                allTables.set(t.table, item);
            }
        });
    }

    return [...Array.from(allTables.values()), ...keywordItems, selectSnippet];
  }
}