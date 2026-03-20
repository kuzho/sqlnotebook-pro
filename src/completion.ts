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
  private usageByTable = new Map<string, number>();
  private usageByColumn = new Map<string, number>();
  private lastStatementSignatureByDocument = new Map<string, string>();

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
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'ON', 'GROUP', 'ORDER',
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

  private getJoinSuggestions(
    aliasMap: Map<string, string>,
    preferredPair?: [string, string]
  ): vscode.CompletionItem[] {
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
          const isPreferredPair = preferredPair
            && ((left === preferredPair[0] && right === preferredPair[1])
              || (left === preferredPair[1] && right === preferredPair[0]));
          item.sortText = `${isPreferredPair ? '0' : '1'}_${text}`;
          item.insertText = text;
          items.push(item);
        });
      });
    });

    return items;
  }

  private getPreferredJoinAliasPair(text: string, aliasMap: Map<string, string>): [string, string] | undefined {
    const entries: Array<{ alias: string; table: string; kind: 'from' | 'join' }> = [];
    const regex = /\b(from|join)\s+([^\s,]+)(?:\s+as)?(?:\s+([a-zA-Z_][\w]*))?/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const kind = match[1].toLowerCase() as 'from' | 'join';
      const table = this.normalizeTableForLookup(match[2]);
      const aliasCandidate = match[3];
      const alias = aliasCandidate && !this.isClauseKeyword(aliasCandidate)
        ? aliasCandidate
        : table;
      entries.push({ alias, table, kind });
    }

    if (entries.length < 2) {
      return undefined;
    }

    const last = entries[entries.length - 1];
    if (last.kind !== 'join') {
      return undefined;
    }

    const previous = entries[entries.length - 2];
    if (!aliasMap.has(last.alias) || !aliasMap.has(previous.alias)) {
      return undefined;
    }

    return [previous.alias, last.alias];
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

  private isPositionInSqlComment(text: string, offset: number): boolean {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBracketIdentifier = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < offset; i++) {
      const ch = text[i];
      const next = i + 1 < offset ? text[i + 1] : '';

      if (inLineComment) {
        if (ch === '\n') {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i++;
        }
        continue;
      }

      if (!inDoubleQuote && !inBracketIdentifier && ch === "'") {
        if (inSingleQuote && next === "'") {
          i++;
          continue;
        }
        inSingleQuote = !inSingleQuote;
        continue;
      }

      if (!inSingleQuote && !inBracketIdentifier && ch === '"') {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote && ch === '[') {
        inBracketIdentifier = true;
        continue;
      }

      if (inBracketIdentifier && ch === ']') {
        inBracketIdentifier = false;
        continue;
      }

      if (inSingleQuote || inDoubleQuote || inBracketIdentifier) {
        continue;
      }

      if (ch === '-' && next === '-') {
        inLineComment = true;
        i++;
        continue;
      }

      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    return inLineComment || inBlockComment;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[]> {

    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor
      && activeEditor.document.uri.toString() === document.uri.toString()
      && activeEditor.selections.some(selection => !selection.isEmpty)
    ) {
      return [];
    }

    const cellText = this.getCellText(document, position);
    const offsetInCell = document.offsetAt(position);
    const textBefore = cellText.substring(0, offsetInCell);
    const lineText = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position));

    if (this.isPositionInSqlComment(cellText, offsetInCell)) {
      return [];
    }

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

    const inOnContext = /\bON\b(?=[^;]*$)/i.test(textBefore)
      && /\b(JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+OUTER\s+JOIN)\b(?=[^;]*$)/i.test(textBefore);
    if (inOnContext) {
      const aliasMap = this.buildAliasMap(textBefore, true);
      const preferredPair = this.getPreferredJoinAliasPair(textBefore, aliasMap);
      const onItems: vscode.CompletionItem[] = [];
      onItems.push(...this.getJoinSuggestions(aliasMap, preferredPair));
      for (const [alias, table] of aliasMap) {
        const aliasRank = preferredPair && (alias === preferredPair[0] || alias === preferredPair[1])
          ? '0'
          : '1';
        const cols = this.getColumnsForTable(table).map(item => {
          const col = item.label.toString();
          const qualified = `${alias}.${col}`;
          const aliasItem = new vscode.CompletionItem(qualified, vscode.CompletionItemKind.Field);
          aliasItem.detail = `Column of ${table}`;
          aliasItem.sortText = `${aliasRank}_${qualified}`;
          aliasItem.insertText = qualified;
          return aliasItem;
        });
        onItems.push(...cols);
      }
      const boolKeywords = ['AND', 'OR', 'IS NULL', 'IS NOT NULL'].map(k => {
        const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
        item.detail = 'Join condition keyword';
        item.sortText = `9_${k}`;
        return item;
      });
      onItems.push(...boolKeywords);
      if (onItems.length > 0) {
        return this.dedupeByLabel(onItems);
      }
    }

    const queryContext = this.getQueryContext(textBefore);
    const currentStatement = this.getCurrentStatement(textBefore);
    this.learnUsageFromStatement(document.uri.toString(), currentStatement);

    const aliasMap = this.buildAliasMap(textBefore);
    const tablesInQuery = this.getTablesInQuery(textBefore);

    const identifierMatch = lineText.match(/([\w\[\]"`\.]+)$/);
    const rawIdentifier = (identifierMatch?.[1] || '').trim();
    const currentIdentifier = this.isClauseKeyword(rawIdentifier) ? '' : rawIdentifier;
    const tableReplaceRange = identifierMatch
      && !this.isClauseKeyword(rawIdentifier)
      ? new vscode.Range(
          new vscode.Position(position.line, position.character - identifierMatch[1].length),
          position
        )
      : undefined;
    const allTables = this.getAllTables(queryContext, currentIdentifier, tableReplaceRange, tablesInQuery);
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
      // FROM/JOIN style ranking like SQL editors: tables first, then clauses.
      const relatedTables = this.getRelatedTables(tablesInQuery);
      const joinClauseSnippets = this.getJoinClauseSnippets(currentStatement);
      this.sortByRelevance(allTables, relatedTables, currentIdentifier);
      this.setSortPrefix(snippets, '00');
      this.setSortPrefix(joinClauseSnippets, '05');
      this.applySessionUsageBoost(allTables, 'table', '08');
      this.boostPrefixMatches(allTables, currentIdentifier, '10');
      this.setSortPrefix(keywordItems, '80');
      return this.dedupeByLabel([...snippets, ...joinClauseSnippets, ...allTables, ...keywordItems]);
    }

    if (queryContext === 'select' || queryContext === 'where' || queryContext === 'order' || queryContext === 'group') {
      // SELECT/WHERE style ranking: alias token -> alias columns -> scoped columns -> keywords.
      const columns = scopedColumns.length > 0 ? scopedColumns : allColumns;
      const qualifiedColumns = aliasMap.size > 0 ? this.getQualifiedColumnsForAliases(aliasMap) : [];

      this.setSortPrefix(snippets, '00');
      this.setSortPrefix(aliasItems, '10');
      this.setSortPrefix(qualifiedColumns, '20');
      this.setSortPrefix(columns, '30');
      this.applySessionUsageBoost(qualifiedColumns, 'column', '22');
      this.applySessionUsageBoost(columns, 'column', '32');
      this.boostPrefixMatches(qualifiedColumns, currentIdentifier, '15');
      this.boostPrefixMatches(columns, currentIdentifier, '25');
      this.setSortPrefix(orderedKeywords, '80');

      return this.dedupeByLabel([
        ...snippets,
        ...aliasItems,
        ...qualifiedColumns,
        ...columns,
        ...orderedKeywords
      ]);
    }

    this.setSortPrefix(snippets, '00');
    this.setSortPrefix(allTables, '20');
    this.setSortPrefix(allColumns, '30');
    this.applySessionUsageBoost(allTables, 'table', '22');
    this.applySessionUsageBoost(allColumns, 'column', '32');
    this.setSortPrefix(orderedKeywords, '80');
    return this.dedupeByLabel([...snippets, ...allTables, ...allColumns, ...orderedKeywords]);
  }

  private getColumnsForTables(tables: string[]): vscode.CompletionItem[] {
    const columnsByName = new Map<string, { tables: Set<string>; count: number }>();

    for (const tableName of tables) {
      const lookupName = this.normalizeTableForLookup(tableName);
      for (const [, schema] of this.consolidatedSchema) {
        const table = schema.find(t => t.table.toLowerCase() === lookupName.toLowerCase());
        if (!table) {
          continue;
        }

        table.columns.forEach(col => {
          if (!columnsByName.has(col)) {
            columnsByName.set(col, { tables: new Set(), count: 0 });
          }
          const info = columnsByName.get(col)!;
          info.tables.add(table.table);
          info.count++; // Track how many times this column appears across tables
        });
      }
    }

    const items: vscode.CompletionItem[] = [];
    columnsByName.forEach((info, colName) => {
      const tableList = Array.from(info.tables).slice(0, 3).join(', ');
      const moreCount = info.tables.size > 3 ? ` (+${info.tables.size - 3} more)` : '';

      const item = new vscode.CompletionItem(colName, vscode.CompletionItemKind.Field);
      item.detail = `Column in: ${tableList}${moreCount}`;
      // Columns appearing in more tables get higher priority (common columns first)
      const commonRank = info.count > 1 ? '0' : '1';
      item.sortText = `${commonRank}_${colName}`;
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

  private getAllTables(
    context: QueryContext,
    currentIdentifier = '',
    replaceRange?: vscode.Range,
    tablesInQuery?: Set<string>
  ): vscode.CompletionItem[] {
    const allTables: vscode.CompletionItem[] = [];

    const prioritizeTables = context === 'from';
    const parts = currentIdentifier.split('.');
    const hasQualifier = parts.length > 1;
    const qualifierPrefix = parts
      .slice(0, -1)
      .map(p => this.normalizeName(p))
      .filter(Boolean)
      .join('.');
    const tablePrefix = this.normalizeName(parts[parts.length - 1] || '');

    for (const [kernelId, schema] of this.consolidatedSchema) {
      const connectionName = kernelId.replace('sql-notebook-', '');

      schema.forEach(t => {
        const normalizedSchema = this.normalizeName(t.schema || '');
        const normalizedSchemaLower = normalizedSchema.toLowerCase();
        const qualifierPrefixLower = qualifierPrefix.toLowerCase();
        const tablePrefixLower = tablePrefix.toLowerCase();

        if (hasQualifier && qualifierPrefix) {
          if (!normalizedSchema) {
            return;
          }
          if (!normalizedSchemaLower.startsWith(qualifierPrefixLower)) {
            return;
          }
        }

        if (tablePrefix && !t.table.toLowerCase().startsWith(tablePrefixLower)) {
          return;
        }

        const label = t.schema ? `${t.schema}.${t.table}` : t.table;
        const tableItem = new vscode.CompletionItem(label, vscode.CompletionItemKind.Class);
        tableItem.detail = t.schema ? `Table (${t.schema})` : `Table (${connectionName})`;
        
        const qualifierRank = hasQualifier
          ? (normalizedSchemaLower === qualifierPrefixLower ? '0' : '1')
          : (prioritizeTables ? '2' : '4');
        
        // Prefix match: if it starts with what user typed
        const isPrefixMatch = tablePrefix && t.table.toLowerCase().startsWith(tablePrefixLower);
        const tableRank = isPrefixMatch ? '0' : (tablePrefix ? '1' : '2');
        
        // Check if this table is already used in the query (less relevant in FROM)
        // But still show it if there are FK relationships
        const isUsedInQuery = tablesInQuery && tablesInQuery.has(t.table.toLowerCase());
        const usageRank = isUsedInQuery ? '3' : '2'; // Used tables go after new ones in FROM
        
        tableItem.sortText = `${qualifierRank}${tableRank}${usageRank}_${label}`;

        tableItem.filterText = label;
        if (replaceRange) {
          tableItem.textEdit = vscode.TextEdit.replace(replaceRange, label);
        } else {
          tableItem.insertText = label;
        }

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

  private setSortPrefix(items: vscode.CompletionItem[], prefix: string): vscode.CompletionItem[] {
    items.forEach(item => {
      const label = item.label.toString();
      item.sortText = `${prefix}_${label}`;
    });
    return items;
  }

  private dedupeByLabel(items: vscode.CompletionItem[]): vscode.CompletionItem[] {
    const seen = new Set<string>();
    const result: vscode.CompletionItem[] = [];

    for (const item of items) {
      const key = `${item.kind ?? ''}:${item.label.toString()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(item);
    }

    return result;
  }

  private boostPrefixMatches(
    items: vscode.CompletionItem[],
    prefix: string,
    boostedPrefix: string
  ): vscode.CompletionItem[] {
    const normalizedPrefix = this.normalizeName(prefix || '').toLowerCase();
    if (!normalizedPrefix) {
      return items;
    }

    items.forEach(item => {
      const label = item.label.toString().toLowerCase();
      const terminal = label.split('.').pop() || label;
      if (terminal.startsWith(normalizedPrefix)) {
        item.sortText = `${boostedPrefix}_${item.label.toString()}`;
      }
    });

    return items;
  }

  private getCurrentStatement(textBefore: string): string {
    const chunks = textBefore.split(';');
    return chunks[chunks.length - 1] || textBefore;
  }

  private getTableReferences(text: string): Array<{ table: string; alias: string }> {
    const refs: Array<{ table: string; alias: string }> = [];
    const regex = /\b(from|join)\s+([^\s,]+)(?:\s+as)?(?:\s+([a-zA-Z_][\w]*))?/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const table = this.normalizeTableForLookup(match[2]);
      const aliasCandidate = match[3];
      const alias = aliasCandidate && !this.isClauseKeyword(aliasCandidate)
        ? aliasCandidate
        : table;
      refs.push({ table, alias });
    }

    return refs;
  }

  private normalizeStatementSignature(statement: string): string {
    return statement
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private incrementUsage(store: Map<string, number>, key: string, delta = 1): void {
    if (!key) {
      return;
    }
    const current = store.get(key) || 0;
    // Cap counts to avoid integer growth during long sessions.
    store.set(key, Math.min(current + delta, 100000));
  }

  private learnUsageFromStatement(documentKey: string, statement: string): void {
    const signature = this.normalizeStatementSignature(statement);
    if (!signature || signature.length < 4) {
      return;
    }

    const prev = this.lastStatementSignatureByDocument.get(documentKey);
    if (prev === signature) {
      return;
    }
    this.lastStatementSignatureByDocument.set(documentKey, signature);

    const refs = this.getTableReferences(statement);
    for (const ref of refs) {
      this.incrementUsage(this.usageByTable, ref.table.toLowerCase(), 2);
    }

    const aliasToTable = new Map<string, string>();
    for (const ref of refs) {
      aliasToTable.set(ref.alias.toLowerCase(), ref.table.toLowerCase());
      aliasToTable.set(ref.table.toLowerCase(), ref.table.toLowerCase());
    }

    const qualifiedRegex = /\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b/g;
    let q: RegExpExecArray | null;
    while ((q = qualifiedRegex.exec(statement)) !== null) {
      const alias = q[1].toLowerCase();
      const col = q[2].toLowerCase();
      const mappedTable = aliasToTable.get(alias);
      this.incrementUsage(this.usageByColumn, col, 1);
      if (mappedTable) {
        this.incrementUsage(this.usageByColumn, `${mappedTable}.${col}`, 2);
      }
    }
  }

  private applySessionUsageBoost(
    items: vscode.CompletionItem[],
    kind: 'table' | 'column',
    basePrefix: string
  ): vscode.CompletionItem[] {
    items.forEach(item => {
      const originalLabel = item.label.toString();
      const label = originalLabel.toLowerCase();
      const terminal = label.split('.').pop() || label;

      let score = 0;
      if (kind === 'table') {
        score = this.usageByTable.get(terminal) || 0;
      } else {
        score = (this.usageByColumn.get(label) || 0)
          + (this.usageByColumn.get(terminal) || 0);
      }

      if (score <= 0) {
        return;
      }

      const usageRank = String(Math.max(0, 9999 - score)).padStart(4, '0');
      item.sortText = `${basePrefix}_${usageRank}_${originalLabel}`;
    });

    return items;
  }

  private getJoinClauseSnippets(textBefore: string): vscode.CompletionItem[] {
    const refs = this.getTableReferences(textBefore);
    if (refs.length === 0) {
      return [];
    }

    const anchor = refs[refs.length - 1];
    const usedTables = new Set(refs.map(r => r.table.toLowerCase()));
    const snippets: vscode.CompletionItem[] = [];

    for (const fk of this.getForeignKeys()) {
      const leftTable = this.normalizeTableForLookup(fk.table);
      const rightTable = this.normalizeTableForLookup(fk.referencedTable);

      let joinTable = '';
      let leftExpr = '';
      let rightExpr = '';

      if (leftTable.toLowerCase() === anchor.table.toLowerCase() && !usedTables.has(rightTable.toLowerCase())) {
        joinTable = fk.referencedTable;
        const joinAlias = rightTable;
        leftExpr = `${anchor.alias}.${fk.column}`;
        rightExpr = `${joinAlias}.${fk.referencedColumn}`;
      } else if (rightTable.toLowerCase() === anchor.table.toLowerCase() && !usedTables.has(leftTable.toLowerCase())) {
        joinTable = fk.table;
        const joinAlias = leftTable;
        leftExpr = `${anchor.alias}.${fk.referencedColumn}`;
        rightExpr = `${joinAlias}.${fk.column}`;
      }

      if (!joinTable) {
        continue;
      }

      const joinBase = this.normalizeTableForLookup(joinTable);
      const label = `JOIN ${joinTable} ON`;
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.detail = `Suggested by FK (${anchor.table} ↔ ${joinBase})`;
      item.sortText = `05_${label}`;
      item.insertText = new vscode.SnippetString(`JOIN ${joinTable} ${joinBase} ON ${leftExpr} = ${rightExpr}`);
      snippets.push(item);
    }

    return this.dedupeByLabel(snippets);
  }

  private getRelatedTables(tablesInQuery: Set<string>): Set<string> {
    const related = new Set<string>();
    const fks = this.getForeignKeys();

    for (const fk of fks) {
      const tableNorm = this.normalizeTableForLookup(fk.table).toLowerCase();
      const refTableNorm = this.normalizeTableForLookup(fk.referencedTable).toLowerCase();

      for (const table of tablesInQuery) {
        const queryTableNorm = table.toLowerCase();
        // If query table is the source of a FK, add the referenced table
        if (queryTableNorm === tableNorm) {
          related.add(refTableNorm);
        }
        // If query table is the target of a FK, add the source table (for JOINS)
        if (queryTableNorm === refTableNorm) {
          related.add(tableNorm);
        }
      }
    }

    return related;
  }

  private sortByRelevance(
    items: vscode.CompletionItem[],
    relatedTables: Set<string>,
    currentIdentifier: string
  ): void {
    // Assign sortText so VS Code orders them correctly:
    // tier 1 = prefix match, tier 2 = FK-related, tier 3 = rest
    const currentId = this.normalizeName(currentIdentifier).toLowerCase();

    items.forEach(item => {
      const label = item.label.toString().toLowerCase();
      const table = label.split('.').pop() || label;

      let tier: string;
      if (currentId && table.startsWith(currentId)) {
        tier = '1';
      } else if (relatedTables.has(table)) {
        tier = '2';
      } else {
        tier = '3';
      }

      item.sortText = `${tier}_${label}`;
    });
  }
}