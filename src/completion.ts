import * as vscode from 'vscode';
import { KernelManager } from './controller';
import { TableSchema } from './driver';

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'DROP', 'ALTER', 'INDEX', 'VIEW',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'ON',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'BETWEEN', 'LIKE', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'CONVERT'
];

type QueryContext = 'select' | 'from' | 'where' | 'join' | 'order' | 'group' | 'unknown';

export class SqlCompletionItemProvider implements vscode.CompletionItemProvider {
  private consolidatedSchema: Map<string, TableSchema[]> = new Map();
  private isRefreshing = false;

  constructor(private kernelManager: KernelManager) {
    this.refreshConsolidatedSchema();

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('sqlnotebook.connections')) {
        this.refreshConsolidatedSchema();
      }
    });
  }

  private async refreshConsolidatedSchema() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      this.consolidatedSchema.clear();
      for (const kernel of this.kernelManager.controllers.values()) {
        const schema = await kernel.getSchemaOrLoad();
        this.consolidatedSchema.set(kernel.id, schema);
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  private getCellText(document: vscode.TextDocument, position: vscode.Position): string {
    const notebook = vscode.workspace.notebookDocuments.find(nb => 
      nb.getCells().some(cell => cell.document === document)
    );

    if (notebook) {
      const currentCell = notebook.getCells().find(cell => cell.document === document);
      if (currentCell) {
        return currentCell.document.getText();
      }
    }

    return document.getText();
  }

  private getQueryContext(textBefore: string): QueryContext {
    const clauses = textBefore.match(/\b(SELECT|FROM|WHERE|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|ORDER\s+BY|GROUP\s+BY|HAVING)\b(?=[^;]*$)/gi);

    if (!clauses || clauses.length === 0) return 'unknown';

    const lastClause = clauses[clauses.length - 1].toUpperCase().replace(/\s+/g, ' ');

    if (lastClause === 'SELECT') return 'select';
    if (lastClause === 'FROM' || lastClause.includes('JOIN')) return 'from';
    if (lastClause === 'WHERE' || lastClause === 'HAVING') return 'where';
    if (lastClause === 'ORDER BY' || lastClause === 'GROUP BY') return 'order';

    return 'unknown';
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {

    const cellText = this.getCellText(document, position);
    const offsetInCell = document.offsetAt(position);
    const textBefore = cellText.substring(0, offsetInCell);
    const lineText = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));

    const matchTable = lineText.match(/(\w+)\.$/);
    if (matchTable) {
        const tableName = matchTable[1];
        return this.getColumnsForTable(tableName);
    }

    const queryContext = this.getQueryContext(textBefore);

    const allTables = this.getAllTables(queryContext);
    const allColumns = this.getAllColumns(queryContext);
    const keywordItems = this.getKeywordItems();
    const snippets = this.getSnippets();

    return [...snippets, ...allColumns, ...allTables, ...keywordItems];
  }

  private getColumnsForTable(tableName: string): vscode.CompletionItem[] {
    let foundColumns: string[] | undefined;
    let sourceTable = tableName;

    for (const [kernelId, schema] of this.consolidatedSchema) {
      const table = schema.find(t => t.table.toLowerCase() === tableName.toLowerCase());
      if (table) {
        foundColumns = table.columns;
        sourceTable = table.table;
        break;
      }
    }

    if (!foundColumns) return [];

    return foundColumns.map(col => {
      const item = new vscode.CompletionItem(col, vscode.CompletionItemKind.Field);
      item.detail = `Column of ${sourceTable}`;
      item.sortText = `0_${col}`;
      return item;
    });
  }

  private getAllTables(context: QueryContext): vscode.CompletionItem[] {
    const allTables: vscode.CompletionItem[] = [];

    const prioritizeTables = context === 'from';

    for (const [kernelId, schema] of this.consolidatedSchema) {
      const connectionName = kernelId.replace('sql-notebook-', '');

      schema.forEach(t => {
        const tableItem = new vscode.CompletionItem(t.table, vscode.CompletionItemKind.Class);
        tableItem.detail = `Table (${connectionName})`;
        tableItem.sortText = prioritizeTables ? `0_${t.table}` : `2_${t.table}`;
        allTables.push(tableItem);
      });
    }

    return allTables;
  }

  private getAllColumns(context: QueryContext): vscode.CompletionItem[] {
    const columnMap = new Map<string, Set<string>>();

    const prioritizeColumns = context === 'select' || context === 'where' || context === 'order';

    for (const [kernelId, schema] of this.consolidatedSchema) {
      schema.forEach(t => {
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
      const tableList = Array.from(tables).slice(0, 3).join(', ');
      const moreCount = tables.size > 3 ? ` (+${tables.size - 3} more)` : '';

      item.detail = `Column in: ${tableList}${moreCount}`;
      item.sortText = prioritizeColumns ? `0_${colName}` : `9_${colName}`;
      item.insertText = colName;

      allColumns.push(item);
    });

    return allColumns;
  }

  private getKeywordItems(): vscode.CompletionItem[] {
    return SQL_KEYWORDS.map(k => {
      const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
      item.detail = 'SQL Keyword';
      item.sortText = `1_${k}`;
      return item;
    });
  }

  private getSnippets(): vscode.CompletionItem[] {
    const selectSnippet = new vscode.CompletionItem('SELECT * FROM', vscode.CompletionItemKind.Snippet);
    selectSnippet.insertText = new vscode.SnippetString('SELECT * FROM ${1:table_name} LIMIT 10;');
    selectSnippet.detail = 'Quick SELECT query';
    selectSnippet.sortText = '00_SNIPPET_SELECT';

    return [selectSnippet];
  }
}