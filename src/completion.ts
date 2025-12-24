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

const TABLE_CONTEXT_KEYWORDS = ['FROM', 'JOIN', 'UPDATE', 'INTO', 'TABLE'];

export class SqlCompletionItemProvider implements vscode.CompletionItemProvider {
  constructor(private kernelManager: KernelManager) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {

    const range = document.getWordRangeAtPosition(position);
    const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const lineText = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));

    const matchTable = lineText.match(/(\w+)\.$/);
    if (matchTable) {
        const tableName = matchTable[1];
        let foundColumns: string[] | undefined;
        let sourceTable = tableName;

        for (const kernel of this.kernelManager.controllers.values()) {
            const schema = await kernel.getSchemaOrLoad();
            const table = schema.find(t => t.table.toLowerCase() === tableName.toLowerCase());
            if (table) {
                foundColumns = table.columns;
                sourceTable = table.table;
                break;
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

    const allKeywordsRegex = new RegExp(`\\b(${SQL_KEYWORDS.join('|').replace(/ /g, '\\s+')})\\b`, 'gi');
    let lastKeyword = '';
    let match;
    while ((match = allKeywordsRegex.exec(textBefore)) !== null) {
        lastKeyword = match[1].toUpperCase().replace(/\s+/g, ' ');
    }

    if (!lastKeyword) lastKeyword = 'SELECT';

    const expectTable = TABLE_CONTEXT_KEYWORDS.some(k => lastKeyword.endsWith(k));
    const allTables: vscode.CompletionItem[] = [];
    const columnMap = new Map<string, Set<string>>();

    for (const kernel of this.kernelManager.controllers.values()) {
        const schema = await kernel.getSchemaOrLoad();
        schema.forEach(t => {
            const tableItem = new vscode.CompletionItem(t.table, vscode.CompletionItemKind.Class);
            tableItem.detail = `Table (${kernel.id.replace('sql-notebook-', '')})`;
            tableItem.sortText = expectTable ? `0_${t.table}` : `2_${t.table}`;
            allTables.push(tableItem);

            t.columns.forEach(col => {
                if (!columnMap.has(col)) {
                    columnMap.set(col, new Set());
                }
                columnMap.get(col)?.add(t.table);
            });
        });
    }

    const allColumns: vscode.CompletionItem[] = [];
    columnMap.forEach((tables, colName) => {
        const item = new vscode.CompletionItem(colName, vscode.CompletionItemKind.Field);
        const tableList = Array.from(tables).join(', ');

        item.detail = `Column in: ${tableList}`;
        item.sortText = expectTable ? `9_${colName}` : `0_${colName}`;
        item.insertText = colName;

        allColumns.push(item);
    });

    const keywordItems = SQL_KEYWORDS.map(k => {
        const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
        item.detail = 'SQL Keyword';
        item.sortText = `1_${k}`;
        return item;
    });

    const selectSnippet = new vscode.CompletionItem('SELECT * FROM', vscode.CompletionItemKind.Snippet);
    selectSnippet.insertText = new vscode.SnippetString('SELECT * FROM ${1:table_name} LIMIT 10;');
    selectSnippet.sortText = '00_SNIPPET';

    return [...allColumns, ...allTables, ...keywordItems, selectSnippet];
  }
}