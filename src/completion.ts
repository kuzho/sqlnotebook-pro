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

    let activeKernel = null;
    for(const k of this.kernelManager.controllers.values()) {
        activeKernel = k;
        break; 
    }

    const keywordItems = SQL_KEYWORDS.map(k => {
        const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
        item.detail = 'SQL Keyword';
        return item;
    });

    const selectSnippet = new vscode.CompletionItem('SELECT * FROM', vscode.CompletionItemKind.Snippet);
    selectSnippet.insertText = new vscode.SnippetString('SELECT * FROM ${1:table_name} LIMIT 10;');
    selectSnippet.detail = "Snippet: Select All";

    if (!activeKernel) return [...keywordItems, selectSnippet];

    const schema = await activeKernel.getSchemaOrLoad();

    const range = document.getWordRangeAtPosition(position);
    const textBefore = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));

    const matchTable = textBefore.match(/(\w+)\.$/);
    if (matchTable) {
        const tableName = matchTable[1];
        const tableData = schema.find(t => t.table === tableName);

        if (tableData) {
            return tableData.columns.map(col => {
                const item = new vscode.CompletionItem(col, vscode.CompletionItemKind.Field);
                item.detail = `Columna de ${tableName}`;
                item.sortText = `0_${col}`;
                return item;
            });
        }
    }

    const tableItems = schema.map(t => {
        const item = new vscode.CompletionItem(t.table, vscode.CompletionItemKind.Class);
        item.detail = "Tabla";
        item.sortText = `1_${t.table}`; 
        return item;
    });

    return [...tableItems, ...keywordItems, selectSnippet];
  }
}