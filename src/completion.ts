import * as vscode from 'vscode';
import { KernelManager } from './controller';
import { ParameterProvider } from './ParameterProvider';
import { TableSchema, ForeignKey } from './driver';

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'DROP', 'ALTER', 'INDEX', 'VIEW',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'ON',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'BETWEEN', 'LIKE', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'CONVERT'
];

const CONTEXT_KEYWORDS: Record<QueryContext, string[]> = {
  select: ['SELECT', 'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END'],
  from: ['FROM', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'ON'],
  where: ['WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'NOT EXISTS'],
  order: ['ORDER BY', 'ASC', 'DESC'],
  group: ['GROUP BY', 'HAVING'],
  join: ['JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL OUTER JOIN', 'ON'],
  unknown: []
};

const DRIVER_KEYWORDS: Record<string, string[]> = {
  mssql: ['TOP', 'NVARCHAR', 'NCHAR', 'DATETIME2', 'TRY_CONVERT', 'TRY_CAST', 'ISNULL'],
  postgres: ['ILIKE', 'SERIAL', 'TEXT', 'RETURNING'],
  mysql: ['AUTO_INCREMENT', 'ENGINE', 'TINYINT', 'MEDIUMINT', 'IFNULL'],
  sqlite: ['AUTOINCREMENT', 'INTEGER', 'TEXT', 'IFNULL'],
  trino: ['PARTITION BY', 'OVER', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'WINDOW', 'LAMBDA']
};

const DRIVER_FUNCTIONS: Record<string, string[]> = {
  mssql: ['GETDATE', 'DATEADD', 'DATEDIFF', 'FORMAT', 'LEN'],
  postgres: ['NOW', 'DATE_TRUNC', 'COALESCE'],
  mysql: ['NOW', 'DATE_ADD', 'DATE_SUB', 'IFNULL'],
  sqlite: ['DATETIME', 'STRFTIME', 'IFNULL'],
  trino: ['date_diff', 'date_add', 'date_trunc', 'format_datetime', 'json_extract', 'json_format', 'try_cast']
};

type QueryContext = 'select' | 'from' | 'where' | 'join' | 'order' | 'group' | 'unknown';

export class SqlCompletionItemProvider implements vscode.CompletionItemProvider {
  private consolidatedSchema: Map<string, TableSchema[]> = new Map();
  private isRefreshing = false;

  constructor(
    private kernelManager: KernelManager,
    private parameterProvider: ParameterProvider
  ) {
    this.refreshConsolidatedSchema();

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('sqlnotebook.connections')) {
        this.refreshConsolidatedSchema();
      }
    });
  }

  private async refreshConsolidatedSchema() {
    if (this.isRefreshing) {
      return;
    }
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

  private getNotebookUri(document: vscode.TextDocument): string | undefined {
    const notebook = vscode.workspace.notebookDocuments.find(nb =>
      nb.getCells().some(cell => cell.document === document)
    );
    return notebook?.uri.toString();
  }

  private normalizeName(name: string): string {
    return name.replace(/^[\[\"`']+|[\]\"`']+$/g, '');
  }

  private normalizeTableForLookup(name: string): string {
    const cleaned = this.normalizeName(name);
    const parts = cleaned.split('.');
    return parts[parts.length - 1];
  }

  private isClauseKeyword(value: string): boolean {
    const token = value.toUpperCase();
    const keywords = new Set([
      'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'ON', 'GROUP', 'ORDER',
      'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'EXCEPT', 'INTERSECT'
    ]);
    return keywords.has(token);
  }

  private buildAliasMap(text: string, includeImplicit = false): Map<string, string> {
    const aliasMap = new Map<string, string>();
    const regex = /\b(from|join)\s+([^\s,]+)(?:\s+as)?(?:\s+([a-zA-Z_][\w]*))?/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const tableToken = this.normalizeTableForLookup(match[2]);
      const aliasCandidate = match[3];
      if (aliasCandidate && !this.isClauseKeyword(aliasCandidate)) {
        aliasMap.set(aliasCandidate, tableToken);
      }
      if (includeImplicit) {
        aliasMap.set(tableToken, tableToken);
      }
    }
    return aliasMap;
  }

  private getTablesInQuery(text: string): Set<string> {
    const tables = new Set<string>();
    const regex = /\b(from|join)\s+([^\s,;]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const tableToken = this.normalizeTableForLookup(match[2]);
      tables.add(tableToken);
    }
    return tables;
  }

  private getForeignKeys(): ForeignKey[] {
    const fks: ForeignKey[] = [];
    for (const schema of this.consolidatedSchema.values()) {
      schema.forEach(t => {
        if (t.foreignKeys) {
          fks.push(...t.foreignKeys);
        }
      });
    }
    return fks;
  }

  private getJoinSuggestions(aliasMap: Map<string, string>): vscode.CompletionItem[] {
    const fks = this.getForeignKeys();
    if (fks.length === 0) {
      return [];
    }

    const aliasesByTable = new Map<string, string[]>();
    for (const [alias, table] of aliasMap) {
      if (!aliasesByTable.has(table)) {
        aliasesByTable.set(table, []);
      }
      aliasesByTable.get(table)?.push(alias);
    }

    const items: vscode.CompletionItem[] = [];
    fks.forEach(fk => {
      const leftAliases = aliasesByTable.get(this.normalizeTableForLookup(fk.table)) || [];
      const rightAliases = aliasesByTable.get(this.normalizeTableForLookup(fk.referencedTable)) || [];

      leftAliases.forEach(left => {
        rightAliases.forEach(right => {
          const text = `${left}.${fk.column} = ${right}.${fk.referencedColumn}`;
          const item = new vscode.CompletionItem(text, vscode.CompletionItemKind.Snippet);
          item.detail = `FK: ${fk.table}.${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn}`;
          item.sortText = `0_${text}`;
          item.insertText = text;
          items.push(item);
        });
      });
    });

    return items;
  }

  private getQueryContext(textBefore: string): QueryContext {
    const clauses = textBefore.match(/\b(SELECT|FROM|WHERE|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|ORDER\s+BY|GROUP\s+BY|HAVING)\b(?=[^;]*$)/gi);

    if (!clauses || clauses.length === 0) {
      return 'unknown';
    }

    const lastClause = clauses[clauses.length - 1].toUpperCase().replace(/\s+/g, ' ');

    if (lastClause === 'SELECT') {
      return 'select';
    }
    if (lastClause === 'FROM' || lastClause.includes('JOIN')) {
      return 'from';
    }
    if (lastClause === 'WHERE' || lastClause === 'HAVING') {
      return 'where';
    }
    if (lastClause === 'ORDER BY') {
      return 'order';
    }
    if (lastClause === 'GROUP BY') {
      return 'group';
    }

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

    const paramMatch = textBefore.match(/@[a-zA-Z0-9_]*$/);
    if (paramMatch) {
      const notebookUri = this.getNotebookUri(document);
      const startCol = position.character - paramMatch[0].length;
      const replaceRange = new vscode.Range(
        new vscode.Position(position.line, startCol),
        position
      );
      const paramItems = this.getParameterItems(notebookUri, replaceRange);
      return paramItems.length > 0 ? paramItems : this.getKeywordItems();
    }

    const matchTable = lineText.match(/([\w\[\]"`\.]+)\.$/);
    if (matchTable) {
      const aliasMap = this.buildAliasMap(textBefore);
      const rawName = this.normalizeName(matchTable[1]);
      const tableName = aliasMap.get(rawName) || this.normalizeTableForLookup(rawName);
      return this.getColumnsForTable(tableName);
    }

    const onClauseMatch = textBefore.match(/\bON\s+$/i);
    if (onClauseMatch) {
      const aliasMap = this.buildAliasMap(textBefore, true);
      const onItems: vscode.CompletionItem[] = [];
      onItems.push(...this.getJoinSuggestions(aliasMap));
      for (const [alias, table] of aliasMap) {
        const cols = this.getColumnsForTable(table).map(item => {
          const col = item.label.toString();
          const qualified = `${alias}.${col}`;
          const aliasItem = new vscode.CompletionItem(qualified, vscode.CompletionItemKind.Field);
          aliasItem.detail = `Column of ${table}`;
          aliasItem.sortText = `0_${qualified}`;
          aliasItem.insertText = qualified;
          return aliasItem;
        });
        onItems.push(...cols);
      }
      if (onItems.length > 0) {
        return onItems;
      }
    }

    const queryContext = this.getQueryContext(textBefore);

    const aliasMap = this.buildAliasMap(textBefore);
    const tablesInQuery = this.getTablesInQuery(textBefore);

    const allTables = this.getAllTables(queryContext);
    const allColumns = this.getAllColumns(queryContext);
    const scopedColumns = tablesInQuery.size > 0
      ? this.getColumnsForTables(Array.from(tablesInQuery))
      : [];
    const aliasItems = aliasMap.size > 0
      ? this.getAliasItems(aliasMap, textBefore)
      : [];
    const notebookUri = this.getNotebookUri(document);
    const driver = this.kernelManager.getDriverForNotebook(
      notebookUri
        ? vscode.workspace.notebookDocuments.find(nb => nb.uri.toString() === notebookUri)
        : vscode.window.activeNotebookEditor?.notebook
    );
    const keywordItems = this.getKeywordItems(driver, queryContext);
    const snippets = this.getSnippets(queryContext, driver);

    const orderedKeywords = queryContext === 'order'
      ? this.prioritizeOrderByKeywords(keywordItems, textBefore)
      : queryContext === 'group'
        ? this.prioritizeGroupByItems(keywordItems, textBefore)
        : keywordItems;

    if (queryContext === 'from') {
      return [...snippets, ...allTables, ...keywordItems];
    }

    if (queryContext === 'select' || queryContext === 'where' || queryContext === 'order' || queryContext === 'group') {
      const columns = scopedColumns.length > 0 ? scopedColumns : allColumns;
      const baseColumns = aliasMap.size > 0 ? [] : columns;
      return [...snippets, ...aliasItems, ...baseColumns, ...orderedKeywords];
    }

    return [...snippets, ...allColumns, ...allTables, ...orderedKeywords];
  }

  private getColumnsForTables(tables: string[]): vscode.CompletionItem[] {
    const columnsByName = new Map<string, { tables: Set<string> }>();

    for (const tableName of tables) {
      const lookupName = this.normalizeTableForLookup(tableName);
      for (const [, schema] of this.consolidatedSchema) {
        const table = schema.find(t => t.table.toLowerCase() === lookupName.toLowerCase());
        if (!table) {
          continue;
        }

        table.columns.forEach(col => {
          if (!columnsByName.has(col)) {
            columnsByName.set(col, { tables: new Set() });
          }
          columnsByName.get(col)?.tables.add(table.table);
        });
      }
    }

    const items: vscode.CompletionItem[] = [];
    columnsByName.forEach((info, colName) => {
      const tableList = Array.from(info.tables).slice(0, 3).join(', ');
      const moreCount = info.tables.size > 3 ? ` (+${info.tables.size - 3} more)` : '';

      const item = new vscode.CompletionItem(colName, vscode.CompletionItemKind.Field);
      item.detail = `Column in: ${tableList}${moreCount}`;
      item.sortText = `0_${colName}`;
      item.insertText = colName;
      items.push(item);
    });

    return items;
  }

  private getQualifiedColumnsForAliases(aliasMap: Map<string, string>): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    for (const [alias, table] of aliasMap) {
      const columns = this.getColumnsForTable(table);
      columns.forEach(colItem => {
        const colName = colItem.label.toString();
        const qualified = `${alias}.${colName}`;
        const item = new vscode.CompletionItem(qualified, vscode.CompletionItemKind.Field);
        item.detail = `Column of ${table}`;
        item.sortText = `0_${qualified}`;
        item.insertText = qualified;
        items.push(item);
      });
    }

    return items;
  }

  private getAliasItems(aliasMap: Map<string, string>, textBefore: string): vscode.CompletionItem[] {
    const tailMatch = textBefore.match(/\b(SELECT|WHERE|ORDER\s+BY|GROUP\s+BY|HAVING)\s*([a-zA-Z_][\w]*)?$/i);
    if (!tailMatch) {
      return [];
    }

    const prefix = (tailMatch[2] || '').toLowerCase();

    const items: vscode.CompletionItem[] = [];

    for (const [alias, table] of aliasMap) {
      if (prefix && !alias.toLowerCase().startsWith(prefix)) {
        continue;
      }
      const label = `${alias}.`;
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Field);
      item.detail = `Columns for ${table}`;
      item.sortText = `0_${label}`;
      item.insertText = label;
      items.push(item);
    }

    return items;
  }

  private prioritizeOrderByKeywords(items: vscode.CompletionItem[], textBefore: string): vscode.CompletionItem[] {
    const ascDesc = new Set(['ASC', 'DESC']);
    const tail: vscode.CompletionItem[] = [];
    const head: vscode.CompletionItem[] = [];
    const afterColumn = /\bORDER\s+BY\s+[\w\]\[\.`"]+(?:\s+AS\s+\w+)?\s*$/i.test(textBefore);

    items.forEach(item => {
      const label = item.label.toString().toUpperCase();
      if (ascDesc.has(label)) {
        if (afterColumn) {
          head.push(item);
        } else {
          tail.push(item);
        }
      } else {
        head.push(item);
      }
    });

    return [...head, ...tail];
  }

  private prioritizeGroupByItems(items: vscode.CompletionItem[], textBefore: string): vscode.CompletionItem[] {
    const aggregates = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
    const afterGroupByColumn = /\bGROUP\s+BY\s+[\w\]\[\.`"]+(?:\s*,\s*[\w\]\[\.`"]+)*\s*$/i.test(textBefore);

    if (!afterGroupByColumn) {
      return items;
    }

    const head: vscode.CompletionItem[] = [];
    const tail: vscode.CompletionItem[] = [];

    items.forEach(item => {
      const label = item.label.toString().toUpperCase();
      if (aggregates.has(label)) {
        head.push(item);
      } else {
        tail.push(item);
      }
    });

    return [...head, ...tail];
  }

  private getParameterItems(notebookUri?: string, replaceRange?: vscode.Range): vscode.CompletionItem[] {
    const params = this.parameterProvider.getParameters(notebookUri);
    const keys = Object.keys(params);
    return keys.map(key => {
      const label = key.startsWith('@') ? key : `@${key}`;
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Variable);
      item.detail = 'SQL Parameter';
      item.sortText = `0_${label}`;
      if (replaceRange) {
        item.textEdit = vscode.TextEdit.replace(replaceRange, label);
      } else {
        item.insertText = label;
      }
      return item;
    });
  }

  private getColumnsForTable(tableName: string): vscode.CompletionItem[] {
    const lookupName = this.normalizeTableForLookup(tableName);
    let foundColumns: string[] | undefined;
    let sourceTable = lookupName;

    for (const [kernelId, schema] of this.consolidatedSchema) {
      const table = schema.find(t => t.table.toLowerCase() === lookupName.toLowerCase());
      if (table) {
        foundColumns = table.columns;
        sourceTable = table.table;
        break;
      }
    }

    if (!foundColumns) {
      return [];
    }

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
        const label = t.schema ? `${t.schema}.${t.table}` : t.table;
        const tableItem = new vscode.CompletionItem(label, vscode.CompletionItemKind.Class);
        tableItem.detail = t.schema ? `Table (${t.schema})` : `Table (${connectionName})`;
        tableItem.sortText = prioritizeTables ? `0_${label}` : `2_${label}`;
        tableItem.insertText = label;
        allTables.push(tableItem);
      });
    }

    return allTables;
  }

  private getAllColumns(context: QueryContext): vscode.CompletionItem[] {
    const columnMap = new Map<string, Set<string>>();

    const prioritizeColumns = context === 'select' || context === 'where' || context === 'order' || context === 'group';

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

  private getKeywordItems(driver?: string, context: QueryContext = 'unknown'): vscode.CompletionItem[] {
    const driverKeywords = driver && DRIVER_KEYWORDS[driver]
      ? DRIVER_KEYWORDS[driver]
      : [];
    const contextKeywords = CONTEXT_KEYWORDS[context];
    let baseKeywords = contextKeywords.length > 0 ? [...contextKeywords] : [...SQL_KEYWORDS];

    // If we are in a FROM or JOIN context, also suggest clauses that can come after the table.
    if (context === 'from' || context === 'join') {
      baseKeywords.push('WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT');
    }

    const keywords = [...new Set([...baseKeywords, ...driverKeywords])];

    const driverFunctions = driver && DRIVER_FUNCTIONS[driver]
      ? DRIVER_FUNCTIONS[driver]
      : [];
    const coreFunctions = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'CONVERT'];
    const functions = context === 'select' || context === 'where' || context === 'order' || context === 'group'
      ? [...coreFunctions, ...driverFunctions]
      : driverFunctions;

    const keywordItems = keywords.map(k => {
      const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
      item.detail = 'SQL Keyword';
      item.sortText = `1_${k}`;
      return item;
    });

    const functionItems = functions.map(fn => {
      const item = new vscode.CompletionItem(fn, vscode.CompletionItemKind.Function);
      item.detail = 'SQL Function';
      item.sortText = `1_${fn}`;
      item.insertText = new vscode.SnippetString(`${fn}($1)`);
      return item;
    });

    return [...keywordItems, ...functionItems];
  }

  private getSnippets(context: QueryContext = 'unknown', driver?: string): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    const selectSnippet = new vscode.CompletionItem('SELECT * FROM', vscode.CompletionItemKind.Snippet);
    selectSnippet.insertText = new vscode.SnippetString('SELECT * FROM ${1:table_name} LIMIT 10;');
    selectSnippet.detail = 'Quick SELECT query';
    selectSnippet.sortText = '00_SNIPPET_SELECT';

    items.push(selectSnippet);

    if (context === 'select' && driver === 'mssql') {
      const topSnippet = new vscode.CompletionItem('TOP (n)', vscode.CompletionItemKind.Snippet);
      topSnippet.insertText = new vscode.SnippetString('TOP (${1:10})');
      topSnippet.detail = 'MSSQL TOP clause';
      topSnippet.sortText = '00_SNIPPET_TOP';
      items.push(topSnippet);
    }

    return items;
  }
}