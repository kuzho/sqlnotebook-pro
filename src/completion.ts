import * as vscode from 'vscode';
import { KernelManager } from './controller';
import { ParameterProvider } from './ParameterProvider';
import { TableSchema, ForeignKey } from './driver';
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'TABLE',
  'DROP',
  'ALTER',
  'INDEX',
  'VIEW',
  'JOIN',
  'INNER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL OUTER JOIN',
  'ON',
  'GROUP BY',
  'ORDER BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'DISTINCT',
  'AND',
  'OR',
  'NOT',
  'NULL',
  'IS',
  'IN',
  'BETWEEN',
  'LIKE',
  'AS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'COALESCE',
  'NULLIF',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'CAST',
  'CONVERT',
  'ROW_NUMBER',
  'RANK',
  'DENSE_RANK',
  'OVER',
  'PARTITION BY',
];
const CONTEXT_KEYWORDS: Record<QueryContext, string[]> = {
  select: [
    'SELECT',
    'DISTINCT',
    'AS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'COALESCE',
    'NULLIF',
  ],
  from: [
    'FROM',
    'JOIN',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'FULL OUTER JOIN',
    'CROSS JOIN',
    'ON',
  ],
  where: [
    'WHERE',
    'AND',
    'OR',
    'NOT',
    'NULL',
    'IS',
    'IN',
    'BETWEEN',
    'LIKE',
    'EXISTS',
    'NOT EXISTS',
  ],
  order: ['ORDER BY', 'ASC', 'DESC'],
  group: ['GROUP BY', 'HAVING'],
  join: [
    'JOIN',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'FULL OUTER JOIN',
    'CROSS JOIN',
    'ON',
  ],
  insert: ['INTO', 'VALUES'],
  update: ['SET', 'WHERE'],
  unknown: [],
};

const DRIVER_KEYWORDS: Record<string, string[]> = {
  mssql: [
    'TOP',
    'NVARCHAR',
    'NCHAR',
    'DATETIME2',
    'TRY_CONVERT',
    'TRY_CAST',
    'ISNULL',
  ],
  postgres: ['ILIKE', 'SERIAL', 'TEXT', 'RETURNING'],
  mysql: ['AUTO_INCREMENT', 'ENGINE', 'TINYINT', 'MEDIUMINT', 'IFNULL'],
  sqlite: ['AUTOINCREMENT', 'INTEGER', 'TEXT', 'IFNULL'],
  trino: [
    'PARTITION BY',
    'OVER',
    'ROWS',
    'RANGE',
    'UNBOUNDED',
    'PRECEDING',
    'FOLLOWING',
    'WINDOW',
    'LAMBDA',
  ],
};

const DRIVER_FUNCTIONS: Record<string, string[]> = {
  mssql: ['GETDATE', 'DATEADD', 'DATEDIFF', 'FORMAT', 'LEN'],
  postgres: ['NOW', 'DATE_TRUNC', 'COALESCE'],
  mysql: ['NOW', 'DATE_ADD', 'DATE_SUB', 'IFNULL'],
  sqlite: ['DATETIME', 'STRFTIME', 'IFNULL'],
  trino: [
    'date_diff',
    'date_add',
    'date_trunc',
    'format_datetime',
    'json_extract',
    'json_format',
    'try_cast',
  ],
};

type QueryContext =
  | 'select'
  | 'from'
  | 'where'
  | 'join'
  | 'order'
  | 'group'
  | 'insert'
  | 'update'
  | 'unknown';

export class SqlCompletionItemProvider
  implements vscode.CompletionItemProvider
{
  private consolidatedSchema: Map<string, TableSchema[]> = new Map();
  private isRefreshing = false;
  private usageByTable = new Map<string, number>();
  private usageByColumn = new Map<string, number>();
  private lastStatementSignatureByDocument = new Map<string, string>();

  constructor(
    private kernelManager: KernelManager,
    private parameterProvider: ParameterProvider,
  ) {
    this.refreshConsolidatedSchema();

    vscode.workspace.onDidChangeConfiguration((e) => {
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

  public getConsolidatedSchema(): Map<string, TableSchema[]> {
    return this.consolidatedSchema;
  }

  private getCellText(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string {
    const notebook = vscode.workspace.notebookDocuments.find((nb) =>
      nb.getCells().some((cell) => cell.document === document),
    );

    if (notebook) {
      const currentCell = notebook
        .getCells()
        .find((cell) => cell.document === document);
      if (currentCell) {
        return currentCell.document.getText();
      }
    }

    return document.getText();
  }

  private getFullContextText(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string {
    const notebook = vscode.workspace.notebookDocuments.find((nb) =>
      nb.getCells().some((cell) => cell.document === document),
    );

    if (notebook) {
      const cells = notebook.getCells();
      const currentIdx = cells.findIndex((cell) => cell.document === document);
      if (currentIdx > 0) {
        const precedingText = cells
          .slice(0, currentIdx)
          .map((c) => c.document.getText())
          .join('\n;\n');
        const offsetInCell = document.offsetAt(position);
        const cellTextBefore = document.getText().substring(0, offsetInCell);
        return `${precedingText}\n;\n${cellTextBefore}`;
      }
    }

    const offsetInCell = document.offsetAt(position);
    return document.getText().substring(0, offsetInCell);
  }

  private getNotebookUri(document: vscode.TextDocument): string | undefined {
    const notebook = vscode.workspace.notebookDocuments.find((nb) =>
      nb.getCells().some((cell) => cell.document === document),
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
      'SELECT',
      'FROM',
      'WHERE',
      'JOIN',
      'INNER',
      'LEFT',
      'RIGHT',
      'FULL',
      'ON',
      'GROUP',
      'ORDER',
      'HAVING',
      'LIMIT',
      'OFFSET',
      'UNION',
      'EXCEPT',
      'INTERSECT',
      'SET',
      'INTO',
      'VALUES',
      'WITH',
    ]);
    return keywords.has(token);
  }

  private buildAliasMap(
    text: string,
    includeImplicit = false,
  ): Map<string, string> {
    const aliasMap = new Map<string, string>();
    const cleanText = text.replace(/WITH\s*\([^)]*\)/gi, '');
    const regex =
      /\b(from|join|update)\s+([^\s,\(]+)(?:\s+as)?(?:\s+([a-zA-Z_][\w]*))?/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(cleanText)) !== null) {
      const tableToken = this.normalizeTableForLookup(match[2]);
      const aliasCandidate = match[3];
      if (aliasCandidate && !this.isClauseKeyword(aliasCandidate)) {
        aliasMap.set(aliasCandidate, tableToken);
      }
      if (includeImplicit) {
        aliasMap.set(tableToken, tableToken);
      }
    }

    const fromMatches = cleanText.matchAll(
      /\bFROM\s+([^\bWHERE\b|\bJOIN\b|\bGROUP\b|\bORDER\b|\bHAVING\b|\bLIMIT\b;]+)/gi,
    );
    for (const fromMatch of fromMatches) {
      const tablesList = fromMatch[1].split(',');
      for (const tItem of tablesList) {
        const parts = tItem.trim().split(/\s+/);
        if (parts.length >= 1) {
          const rawTable = parts[0];
          if (
            rawTable &&
            !this.isClauseKeyword(rawTable) &&
            !rawTable.startsWith('(')
          ) {
            const tableToken = this.normalizeTableForLookup(rawTable);
            let aliasCandidate =
              parts.length >= 2 ? parts[parts.length - 1] : undefined;
            if (
              aliasCandidate &&
              aliasCandidate.toUpperCase() === 'AS' &&
              parts.length >= 3
            ) {
              aliasCandidate = parts[parts.length - 1];
            }
            if (aliasCandidate && !this.isClauseKeyword(aliasCandidate)) {
              aliasMap.set(aliasCandidate, tableToken);
            }
            if (includeImplicit) {
              aliasMap.set(tableToken, tableToken);
            }
          }
        }
      }
    }

    return aliasMap;
  }

  public getTablesInQuery(text: string): Set<string> {
    const tables = new Set<string>();
    const cleanText = text.replace(/WITH\s*\([^)]*\)/gi, '');
    const regex = /\b(from|join|update|into)\s+([^\s,\(;]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(cleanText)) !== null) {
      const tableToken = this.normalizeTableForLookup(match[2]);
      if (tableToken && !this.isClauseKeyword(tableToken)) {
        tables.add(tableToken);
      }
    }

    const fromMatches = cleanText.matchAll(
      /\bFROM\s+([^\bWHERE\b|\bJOIN\b|\bGROUP\b|\bORDER\b|\bHAVING\b|\bLIMIT\b;]+)/gi,
    );
    for (const fromMatch of fromMatches) {
      const tablesList = fromMatch[1].split(',');
      for (const tItem of tablesList) {
        const parts = tItem.trim().split(/\s+/);
        if (parts.length >= 1) {
          const rawTable = parts[0];
          if (
            rawTable &&
            !this.isClauseKeyword(rawTable) &&
            !rawTable.startsWith('(')
          ) {
            const tableToken = this.normalizeTableForLookup(rawTable);
            if (tableToken) {
              tables.add(tableToken);
            }
          }
        }
      }
    }

    return tables;
  }

  private getCTEs(text: string): Set<string> {
    const ctes = new Set<string>();
    const regex = /\bWITH\s+([a-zA-Z_][\w]*)\s+AS/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      ctes.add(match[1]);
    }
    const regexChained = /,\s*([a-zA-Z_][\w]*)\s+AS\s*\(/gi;
    while ((match = regexChained.exec(text)) !== null) {
      ctes.add(match[1]);
    }
    return ctes;
  }

  private getForeignKeys(): ForeignKey[] {
    const fks: ForeignKey[] = [];
    for (const schema of this.consolidatedSchema.values()) {
      schema.forEach((t) => {
        if (t.foreignKeys) {
          fks.push(...t.foreignKeys);
        }
      });
    }
    return fks;
  }

  private getJoinSuggestions(
    aliasMap: Map<string, string>,
    preferredPair?: [string, string],
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
    fks.forEach((fk) => {
      const leftAliases =
        aliasesByTable.get(this.normalizeTableForLookup(fk.table)) || [];
      const rightAliases =
        aliasesByTable.get(this.normalizeTableForLookup(fk.referencedTable)) ||
        [];

      leftAliases.forEach((left) => {
        rightAliases.forEach((right) => {
          const text = `${left}.${fk.column} = ${right}.${fk.referencedColumn}`;
          const item = new vscode.CompletionItem(
            text,
            vscode.CompletionItemKind.Snippet,
          );
          item.detail = `FK: ${fk.table}.${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn}`;
          const isPreferredPair =
            preferredPair &&
            ((left === preferredPair[0] && right === preferredPair[1]) ||
              (left === preferredPair[1] && right === preferredPair[0]));
          item.sortText = `${isPreferredPair ? '0' : '1'}_${text}`;
          item.insertText = text;
          items.push(item);
        });
      });
    });

    return items;
  }

  private getPreferredJoinAliasPair(
    text: string,
    aliasMap: Map<string, string>,
  ): [string, string] | undefined {
    const entries: Array<{
      alias: string;
      table: string;
      kind: 'from' | 'join';
    }> = [];
    const regex =
      /\b(from|join)\s+([^\s,]+)(?:\s+as)?(?:\s+([a-zA-Z_][\w]*))?/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const kind = match[1].toLowerCase() as 'from' | 'join';
      const table = this.normalizeTableForLookup(match[2]);
      const aliasCandidate = match[3];
      const alias =
        aliasCandidate && !this.isClauseKeyword(aliasCandidate)
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
    const clauses = textBefore.match(
      /\b(SELECT|FROM|WHERE|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+OUTER\s+JOIN|ORDER\s+BY|GROUP\s+BY|HAVING|INSERT\s+INTO|UPDATE|SET|VALUES)\b(?=[^;]*$)/gi,
    );

    if (!clauses || clauses.length === 0) {
      return 'unknown';
    }

    const lastClause = clauses[clauses.length - 1]
      .toUpperCase()
      .replace(/\s+/g, ' ');

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
    if (lastClause === 'INSERT INTO' || lastClause === 'VALUES') {
      return 'insert';
    }
    if (lastClause === 'UPDATE' || lastClause === 'SET') {
      return 'update';
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
    context: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[]> {
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor &&
      activeEditor.document.uri.toString() === document.uri.toString() &&
      activeEditor.selections.some((selection) => !selection.isEmpty)
    ) {
      return [];
    }

    const contextText = this.getFullContextText(document, position);
    const cellText = this.getCellText(document, position);
    const offsetInCell = document.offsetAt(position);
    const textBefore = cellText.substring(0, offsetInCell);
    const lineText = document.getText(
      new vscode.Range(new vscode.Position(position.line, 0), position),
    );

    if (this.isPositionInSqlComment(cellText, offsetInCell)) {
      return [];
    }

    const paramMatch = textBefore.match(/@[a-zA-Z0-9_]*$/);
    if (paramMatch) {
      const notebookUri = this.getNotebookUri(document);
      const startCol = position.character - paramMatch[0].length;
      const replaceRange = new vscode.Range(
        new vscode.Position(position.line, startCol),
        position,
      );
      const paramItems = this.getParameterItems(notebookUri, replaceRange);
      return paramItems.length > 0 ? paramItems : this.getKeywordItems();
    }

    const matchTable = lineText.match(/([\w\[\]"`\.]+)\.$/);
    if (matchTable) {
      const aliasMap = this.buildAliasMap(contextText);
      const rawName = this.normalizeName(matchTable[1]);
      return this.getSchemaOrTableItems(rawName, aliasMap);
    }

    const inOnContext =
      /\bON\b(?=[^;]*$)/i.test(textBefore) &&
      /\b(JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+OUTER\s+JOIN)\b(?=[^;]*$)/i.test(
        textBefore,
      );
    if (inOnContext) {
      const aliasMap = this.buildAliasMap(contextText, true);
      const preferredPair = this.getPreferredJoinAliasPair(
        textBefore,
        aliasMap,
      );
      const onItems: vscode.CompletionItem[] = [];
      onItems.push(...this.getJoinSuggestions(aliasMap, preferredPair));
      for (const [alias, table] of aliasMap) {
        const aliasRank =
          preferredPair &&
          (alias === preferredPair[0] || alias === preferredPair[1])
            ? '0'
            : '1';
        const cols = this.getColumnsForTable(table).map((item) => {
          const col = item.label.toString();
          const qualified = `${alias}.${col}`;
          const aliasItem = new vscode.CompletionItem(
            qualified,
            vscode.CompletionItemKind.Field,
          );
          aliasItem.detail = `Column of ${table}`;
          aliasItem.sortText = `${aliasRank}_${qualified}`;
          aliasItem.insertText = qualified;
          aliasItem.documentation = item.documentation;
          return aliasItem;
        });
        onItems.push(...cols);
      }
      const boolKeywords = ['AND', 'OR', 'IS NULL', 'IS NOT NULL'].map((k) => {
        const item = new vscode.CompletionItem(
          k,
          vscode.CompletionItemKind.Keyword,
        );
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

    const aliasMap = this.buildAliasMap(contextText);
    const tablesInQuery = this.getTablesInQuery(contextText);

    const ctes = this.getCTEs(contextText);
    ctes.forEach((c) => tablesInQuery.add(c));

    const identifierMatch = lineText.match(/([\w\[\]"`\.]+)$/);
    const rawIdentifier = (identifierMatch?.[1] || '').trim();
    const currentIdentifier = this.isClauseKeyword(rawIdentifier)
      ? ''
      : rawIdentifier;
    const tableReplaceRange =
      identifierMatch && !this.isClauseKeyword(rawIdentifier)
        ? new vscode.Range(
            new vscode.Position(
              position.line,
              position.character - identifierMatch[1].length,
            ),
            position,
          )
        : undefined;

    const cteItems = Array.from(ctes).map((cte) => {
      const item = new vscode.CompletionItem(
        cte,
        vscode.CompletionItemKind.Class,
      );
      item.detail = 'CTE (Temporary Table)';
      item.sortText = `05_${cte}`;
      item.insertText = cte;
      return item;
    });
    const allTables = [
      ...cteItems,
      ...this.getAllTables(
        queryContext,
        currentIdentifier,
        tableReplaceRange,
        tablesInQuery,
      ),
    ];
    const allColumns = this.getAllColumns(queryContext);
    const scopedColumns =
      tablesInQuery.size > 0
        ? this.getColumnsForTables(Array.from(tablesInQuery))
        : [];
    const aliasItems =
      aliasMap.size > 0 ? this.getAliasItems(aliasMap, textBefore) : [];
    const notebookUri = this.getNotebookUri(document);
    const driver = this.kernelManager.getDriverForNotebook(
      notebookUri
        ? vscode.workspace.notebookDocuments.find(
            (nb) => nb.uri.toString() === notebookUri,
          )
        : vscode.window.activeNotebookEditor?.notebook,
    );
    const keywordItems = this.getKeywordItems(driver, queryContext);
    const snippets = this.getSnippets(queryContext, driver);

    if (queryContext === 'select' || /\bSELECT\s+$/i.test(textBefore)) {
      const selectAllSnippet = this.getSelectAllColumnsSnippet(
        aliasMap,
        tablesInQuery,
      );
      if (selectAllSnippet) {
        snippets.unshift(selectAllSnippet);
      }
    }

    if (queryContext === 'insert' || queryContext === 'update') {
      const targetMatch = textBefore.match(
        /\b(?:INSERT\s+INTO|UPDATE)\s+([^\s\(\)]+)/i,
      );
      let targetColumns: vscode.CompletionItem[] = [];
      if (targetMatch) {
        const targetTable = this.normalizeTableForLookup(targetMatch[1]);
        targetColumns = this.getColumnsForTable(targetTable);
        this.setSortPrefix(targetColumns, '10');
      }
      this.setSortPrefix(keywordItems, '80');
      return this.dedupeByLabel([
        ...snippets,
        ...targetColumns,
        ...allColumns,
        ...keywordItems,
      ]);
    }

    const orderedKeywords =
      queryContext === 'order'
        ? this.prioritizeOrderByKeywords(keywordItems, textBefore)
        : queryContext === 'group'
          ? this.prioritizeGroupByItems(keywordItems, textBefore)
          : keywordItems;

    if (queryContext === 'from') {
      const relatedTables = this.getRelatedTables(tablesInQuery);
      const joinClauseSnippets = this.getJoinClauseSnippets(currentStatement);
      this.sortByRelevance(allTables, relatedTables, currentIdentifier);
      this.setSortPrefix(snippets, '00');
      this.setSortPrefix(joinClauseSnippets, '05');
      this.applySessionUsageBoost(allTables, 'table', '08');
      this.boostPrefixMatches(allTables, currentIdentifier, '10');
      this.setSortPrefix(keywordItems, '80');
      return this.dedupeByLabel([
        ...snippets,
        ...joinClauseSnippets,
        ...allTables,
        ...keywordItems,
      ]);
    }

    const standaloneAliasItems = Array.from(aliasMap.keys()).map((alias) => {
      const item = new vscode.CompletionItem(
        alias,
        vscode.CompletionItemKind.Variable,
      );
      item.detail = `Alias for ${aliasMap.get(alias)}`;
      item.sortText = `05_${alias}`;
      return item;
    });

    if (
      queryContext === 'select' ||
      queryContext === 'where' ||
      queryContext === 'order' ||
      queryContext === 'group'
    ) {
      const columns = scopedColumns.length > 0 ? scopedColumns : allColumns;
      const qualifiedColumns =
        aliasMap.size > 0 ? this.getQualifiedColumnsForAliases(aliasMap) : [];

      this.setSortPrefix(snippets, '00');
      this.setSortPrefix(standaloneAliasItems, '05');
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
        ...standaloneAliasItems,
        ...aliasItems,
        ...qualifiedColumns,
        ...columns,
        ...orderedKeywords,
      ]);
    }

    this.setSortPrefix(snippets, '00');
    this.setSortPrefix(allTables, '20');
    this.setSortPrefix(allColumns, '30');
    this.applySessionUsageBoost(allTables, 'table', '22');
    this.applySessionUsageBoost(allColumns, 'column', '32');
    this.setSortPrefix(orderedKeywords, '80');
    return this.dedupeByLabel([
      ...snippets,
      ...allTables,
      ...allColumns,
      ...orderedKeywords,
    ]);
  }

  private getSelectAllColumnsSnippet(
    aliasMap: Map<string, string>,
    tablesInQuery: Set<string>,
  ): vscode.CompletionItem | undefined {
    const colList: string[] = [];

    if (aliasMap.size > 0) {
      for (const [alias, table] of aliasMap) {
        const cols = this.getRawColumnNames(table);
        cols.forEach((c) => colList.push(`${alias}.${c}`));
      }
    } else if (tablesInQuery.size > 0) {
      for (const table of tablesInQuery) {
        const cols = this.getRawColumnNames(table);
        cols.forEach((c) => colList.push(c));
      }
    }

    if (colList.length === 0) {
      return undefined;
    }

    const expanded = colList.join(', ');
    const item = new vscode.CompletionItem(
      `* (Expand ${colList.length} columns)`,
      vscode.CompletionItemKind.Snippet,
    );
    item.detail = `Expands * to: ${expanded.slice(0, 60)}${expanded.length > 60 ? '...' : ''}`;
    item.documentation = new vscode.MarkdownString(
      `Expands \`*\` to all columns from query tables:\n\`\`\`sql\n${expanded}\n\`\`\``,
    );
    item.sortText = `00_*_EXPAND`;
    item.insertText = expanded;
    return item;
  }

  private getRawColumnNames(tableName: string): string[] {
    const lookupName = this.normalizeTableForLookup(tableName);
    for (const [, schema] of this.consolidatedSchema) {
      const table = schema.find(
        (t) => t.table.toLowerCase() === lookupName.toLowerCase(),
      );
      if (table) {
        return table.columns;
      }
    }
    return [];
  }

  private getColumnsForTables(tables: string[]): vscode.CompletionItem[] {
    const columnsByName = new Map<
      string,
      { tables: Set<string>; count: number; typeStr: string }
    >();

    for (const tableName of tables) {
      const lookupName = this.normalizeTableForLookup(tableName);
      for (const [, schema] of this.consolidatedSchema) {
        const table = schema.find(
          (t) => t.table.toLowerCase() === lookupName.toLowerCase(),
        );
        if (!table) {
          continue;
        }

        table.columns.forEach((col) => {
          if (!columnsByName.has(col)) {
            columnsByName.set(col, {
              tables: new Set(),
              count: 0,
              typeStr: table.columnTypes?.[col] || '',
            });
          }
          const info = columnsByName.get(col)!;
          info.tables.add(table.table);
          info.count++;
        });
      }
    }

    const items: vscode.CompletionItem[] = [];
    columnsByName.forEach((info, colName) => {
      const tableList = Array.from(info.tables).slice(0, 3).join(', ');
      const moreCount =
        info.tables.size > 3 ? ` (+${info.tables.size - 3} more)` : '';

      const item = new vscode.CompletionItem(
        colName,
        vscode.CompletionItemKind.Field,
      );
      const typeDisplay = info.typeStr ? ` (${info.typeStr})` : '';
      item.detail = `Column in: ${tableList}${moreCount}${typeDisplay}`;
      const doc = new vscode.MarkdownString();
      doc.appendMarkdown(`### Column \`${colName}\`\n\n`);
      doc.appendMarkdown(
        `- **Found in tables:** \`${Array.from(info.tables).join('`, `')}\`\n`,
      );
      if (info.typeStr) {
        doc.appendMarkdown(`- **Type:** \`${info.typeStr}\`\n`);
      }
      item.documentation = doc;
      const commonRank = info.count > 1 ? '0' : '1';
      item.sortText = `${commonRank}_${colName}`;
      item.insertText = colName;
      items.push(item);
    });

    return items;
  }

  private getQualifiedColumnsForAliases(
    aliasMap: Map<string, string>,
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    for (const [alias, table] of aliasMap) {
      const columns = this.getColumnsForTable(table);
      let colTypes: Record<string, string> = {};
      for (const [, schema] of this.consolidatedSchema) {
        const lookup = schema.find(
          (t) =>
            t.table.toLowerCase() ===
            this.normalizeTableForLookup(table).toLowerCase(),
        );
        if (lookup && lookup.columnTypes) {
          colTypes = lookup.columnTypes;
          break;
        }
      }

      columns.forEach((colItem) => {
        const colName = colItem.label.toString();
        const typeDisplay = colTypes[colName] ? ` (${colTypes[colName]})` : '';
        const qualified = `${alias}.${colName}`;
        const item = new vscode.CompletionItem(
          qualified,
          vscode.CompletionItemKind.Field,
        );
        item.detail = `Column of ${table}${typeDisplay}`;
        item.documentation = colItem.documentation;
        item.sortText = `0_${qualified}`;
        item.insertText = qualified;
        items.push(item);
      });
    }

    return items;
  }

  private getAliasItems(
    aliasMap: Map<string, string>,
    textBefore: string,
  ): vscode.CompletionItem[] {
    const tailMatch = textBefore.match(
      /\b(SELECT|WHERE|ORDER\s+BY|GROUP\s+BY|HAVING)\s*([a-zA-Z_][\w]*)?$/i,
    );
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
      const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Field,
      );
      item.detail = `Columns for ${table}`;
      item.sortText = `0_${label}`;
      item.insertText = label;
      items.push(item);
    }

    return items;
  }

  private prioritizeOrderByKeywords(
    items: vscode.CompletionItem[],
    textBefore: string,
  ): vscode.CompletionItem[] {
    const ascDesc = new Set(['ASC', 'DESC']);
    const tail: vscode.CompletionItem[] = [];
    const head: vscode.CompletionItem[] = [];
    const afterColumn =
      /\bORDER\s+BY\s+[\w\]\[\.`"]+(?:\s+AS\s+\w+)?\s*$/i.test(textBefore);

    items.forEach((item) => {
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

  private getSchemaOrTableItems(
    rawName: string,
    aliasMap: Map<string, string>,
  ): vscode.CompletionItem[] {
    const resolvedTable =
      aliasMap.get(rawName) || this.normalizeTableForLookup(rawName);
    const columnItems = this.getColumnsForTable(resolvedTable);

    if (columnItems.length > 0) {
      const allColNames = columnItems
        .map((c) => `${rawName}.${c.label.toString()}`)
        .join(', ');
      const expandItem = new vscode.CompletionItem(
        `* (Expand all ${columnItems.length} columns)`,
        vscode.CompletionItemKind.Snippet,
      );
      expandItem.detail = `Expand to: ${allColNames.slice(0, 60)}...`;
      expandItem.sortText = `00_*`;
      expandItem.insertText = allColNames;
      columnItems.unshift(expandItem);
    }

    const schemaTables: vscode.CompletionItem[] = [];
    for (const [, schema] of this.consolidatedSchema) {
      schema.forEach((t) => {
        if (t.schema && t.schema.toLowerCase() === rawName.toLowerCase()) {
          const tableLabel = t.table;
          const item = new vscode.CompletionItem(
            tableLabel,
            t.type === 'view'
              ? vscode.CompletionItemKind.Interface
              : vscode.CompletionItemKind.Class,
          );
          item.detail = `${t.type === 'view' ? 'View' : 'Table'} in ${t.schema}`;
          item.sortText = `0_${t.table}`;
          item.insertText = tableLabel;
          schemaTables.push(item);
        }
      });
    }

    if (schemaTables.length > 0) {
      return this.dedupeByLabel([...schemaTables, ...columnItems]);
    }

    return columnItems;
  }

  private getUnaggregatedSelectColumns(
    textBefore: string,
  ): vscode.CompletionItem[] {
    const selectMatch = textBefore.match(/\bSELECT\s+([\s\S]*?)\bFROM\b/i);
    if (!selectMatch) {
      return [];
    }
    const selectBody = selectMatch[1];
    const rawCols = selectBody.split(',');
    const items: vscode.CompletionItem[] = [];
    for (const rawCol of rawCols) {
      const trimmed = rawCol.trim();
      if (
        !trimmed ||
        /\b(COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF)\s*\(/i.test(trimmed)
      ) {
        continue;
      }
      const noAlias = trimmed.replace(/\s+AS\s+[\w`"\[\]]+$/i, '').trim();
      if (noAlias && !noAlias.includes('*')) {
        const colName = noAlias.split('.').pop() || noAlias;
        const item = new vscode.CompletionItem(
          noAlias,
          vscode.CompletionItemKind.Field,
        );
        item.detail = `Selected column for GROUP BY`;
        item.sortText = `00_${colName}`;
        item.insertText = noAlias;
        items.push(item);
      }
    }
    return items;
  }

  private prioritizeGroupByItems(
    items: vscode.CompletionItem[],
    textBefore: string,
  ): vscode.CompletionItem[] {
    const unaggregated = this.getUnaggregatedSelectColumns(textBefore);
    const aggregates = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
    const afterGroupByColumn =
      /\bGROUP\s+BY\s+[\w\]\[\.`"]+(?:\s*,\s*[\w\]\[\.`"]+)*\s*$/i.test(
        textBefore,
      );

    if (!afterGroupByColumn) {
      return this.dedupeByLabel([...unaggregated, ...items]);
    }

    const head: vscode.CompletionItem[] = [];
    const tail: vscode.CompletionItem[] = [];

    items.forEach((item) => {
      const label = item.label.toString().toUpperCase();
      if (aggregates.has(label)) {
        head.push(item);
      } else {
        tail.push(item);
      }
    });

    return this.dedupeByLabel([...unaggregated, ...head, ...tail]);
  }

  private getParameterItems(
    notebookUri?: string,
    replaceRange?: vscode.Range,
  ): vscode.CompletionItem[] {
    const params = this.parameterProvider.getParameters(notebookUri);
    const keys = Object.keys(params);
    return keys.map((key) => {
      const label = key.startsWith('@') ? key : `@${key}`;
      const paramVal = params[key];
      let detail = 'SQL Parameter';
      const doc = new vscode.MarkdownString();
      doc.appendMarkdown(`### Parameter \`${label}\`\n\n`);

      if (paramVal && typeof paramVal === 'object') {
        const typeStr = paramVal.type || 'text';
        const reqStr = paramVal.required ? 'Yes' : 'No';
        const valStr =
          paramVal.value !== undefined ? String(paramVal.value) : '(empty)';
        detail = `SQL Parameter (${typeStr})${paramVal.value ? ` = "${paramVal.value}"` : ''}`;
        doc.appendMarkdown(`- **Type:** \`${typeStr}\`\n`);
        doc.appendMarkdown(`- **Value:** \`${valStr}\`\n`);
        doc.appendMarkdown(`- **Required:** ${reqStr}\n`);
      } else if (
        typeof paramVal === 'string' ||
        typeof paramVal === 'number' ||
        typeof paramVal === 'boolean'
      ) {
        detail = `SQL Parameter = "${paramVal}"`;
        doc.appendMarkdown(`- **Value:** \`${paramVal}\`\n`);
      }
      const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Variable,
      );
      item.detail = detail;
      item.documentation = doc;
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
    let columnTypes: Record<string, string> | undefined;
    let schemaTableObj: TableSchema | undefined;

    for (const [, schema] of this.consolidatedSchema) {
      const table = schema.find(
        (t) => t.table.toLowerCase() === lookupName.toLowerCase(),
      );
      if (table) {
        foundColumns = table.columns;
        sourceTable = table.table;
        columnTypes = table.columnTypes;
        schemaTableObj = table;
        break;
      }
    }

    if (!foundColumns) {
      return [];
    }

    return foundColumns.map((col) => {
      const item = new vscode.CompletionItem(
        col,
        vscode.CompletionItemKind.Field,
      );
      const typeStr = columnTypes?.[col] ? ` (${columnTypes[col]})` : '';
      item.detail = `Column of ${sourceTable}${typeStr}`;

      const isPk = schemaTableObj?.primaryKeys?.includes(col);
      const fk = schemaTableObj?.foreignKeys?.find((f) => f.column === col);

      const doc = new vscode.MarkdownString();
      doc.appendMarkdown(`### Column \`${col}\`\n\n`);
      doc.appendMarkdown(`- **Table:** \`${sourceTable}\`\n`);
      if (columnTypes?.[col]) {
        doc.appendMarkdown(`- **Type:** \`${columnTypes[col]}\`\n`);
      }
      if (isPk) {
        doc.appendMarkdown(`- 🔑 **Primary Key**\n`);
      }
      if (fk) {
        doc.appendMarkdown(
          `- 🔗 **Foreign Key:** \`-> ${fk.referencedTable}.${fk.referencedColumn}\`\n`,
        );
      }

      item.documentation = doc;
      item.sortText = `0_${col}`;
      return item;
    });
  }

  private getAllTables(
    context: QueryContext,
    currentIdentifier = '',
    replaceRange?: vscode.Range,
    tablesInQuery?: Set<string>,
  ): vscode.CompletionItem[] {
    const allTables: vscode.CompletionItem[] = [];

    const prioritizeTables = context === 'from';
    const parts = currentIdentifier.split('.');
    const hasQualifier = parts.length > 1;
    const qualifierPrefix = parts
      .slice(0, -1)
      .map((p) => this.normalizeName(p))
      .filter(Boolean)
      .join('.');
    const tablePrefix = this.normalizeName(parts[parts.length - 1] || '');

    for (const [kernelId, schema] of this.consolidatedSchema) {
      const connectionName = kernelId.replace('sql-notebook-', '');

      schema.forEach((t) => {
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

        if (
          tablePrefix &&
          !t.table.toLowerCase().startsWith(tablePrefixLower)
        ) {
          return;
        }

        const label = t.schema ? `${t.schema}.${t.table}` : t.table;
        const tableItem = new vscode.CompletionItem(
          label,
          vscode.CompletionItemKind.Class,
        );
        tableItem.detail = t.schema
          ? `Table (${t.schema})`
          : `Table (${connectionName})`;

        const doc = new vscode.MarkdownString();
        doc.appendMarkdown(
          `### ${t.type === 'view' ? 'View' : 'Table'} \`${label}\`\n\n`,
        );
        if (t.schema) {
          doc.appendMarkdown(`- **Schema:** \`${t.schema}\`\n`);
        }
        doc.appendMarkdown(
          `- **Columns (${t.columns.length}):** ${t.columns
            .slice(0, 10)
            .map((c) => `\`${c}\``)
            .join(', ')}${t.columns.length > 10 ? '...' : ''}\n`,
        );
        if (t.primaryKeys && t.primaryKeys.length > 0) {
          doc.appendMarkdown(
            `- 🔑 **Primary Key:** ${t.primaryKeys.map((k) => `\`${k}\``).join(', ')}\n`,
          );
        }
        if (t.foreignKeys && t.foreignKeys.length > 0) {
          doc.appendMarkdown(
            `- 🔗 **Foreign Keys (${t.foreignKeys.length}):** ${t.foreignKeys.map((fk) => `\`${fk.column} -> ${fk.referencedTable}.${fk.referencedColumn}\``).join(', ')}\n`,
          );
        }
        tableItem.documentation = doc;

        const qualifierRank = hasQualifier
          ? normalizedSchemaLower === qualifierPrefixLower
            ? '0'
            : '1'
          : prioritizeTables
            ? '2'
            : '4';

        const isPrefixMatch =
          tablePrefix && t.table.toLowerCase().startsWith(tablePrefixLower);
        const tableRank = isPrefixMatch ? '0' : tablePrefix ? '1' : '2';

        const isUsedInQuery =
          tablesInQuery && tablesInQuery.has(t.table.toLowerCase());
        const usageRank = isUsedInQuery ? '3' : '2';

        tableItem.sortText = `${qualifierRank}${tableRank}${usageRank}_${label}`;

        tableItem.filterText = label;
        if (replaceRange) {
          tableItem.textEdit = vscode.TextEdit.replace(replaceRange, label);
        } else {
          tableItem.insertText = label;
        }

        allTables.push(tableItem);

        if (prioritizeTables && !hasQualifier) {
          const alias = generateTableAlias(t.table);
          const aliasLabel = `${label} ${alias}`;
          const aliasItem = new vscode.CompletionItem(
            aliasLabel,
            vscode.CompletionItemKind.Snippet,
          );
          aliasItem.detail = `Table with alias: ${alias}`;
          aliasItem.documentation = doc;
          aliasItem.sortText = `${qualifierRank}${tableRank}${usageRank}_1_${label}`;
          aliasItem.insertText = new vscode.SnippetString(
            `${label} \${1:${alias}}`,
          );
          allTables.push(aliasItem);
        }
      });
    }

    return allTables;
  }

  private getAllColumns(context: QueryContext): vscode.CompletionItem[] {
    const columnMap = new Map<
      string,
      { tables: Set<string>; typeStr: string }
    >();

    const prioritizeColumns =
      context === 'select' ||
      context === 'where' ||
      context === 'order' ||
      context === 'group';

    for (const [, schema] of this.consolidatedSchema) {
      schema.forEach((t) => {
        t.columns.forEach((col) => {
          if (!columnMap.has(col)) {
            columnMap.set(col, { tables: new Set(), typeStr: '' });
          }
          const info = columnMap.get(col)!;
          info.tables.add(t.table);
          if (t.columnTypes?.[col] && !info.typeStr) {
            info.typeStr = t.columnTypes[col];
          }
        });
      });
    }

    const allColumns: vscode.CompletionItem[] = [];
    columnMap.forEach((info, colName) => {
      const item = new vscode.CompletionItem(
        colName,
        vscode.CompletionItemKind.Field,
      );
      const tableList = Array.from(info.tables).slice(0, 3).join(', ');
      const moreCount =
        info.tables.size > 3 ? ` (+${info.tables.size - 3} more)` : '';
      const typeDisplay = info.typeStr ? ` (${info.typeStr})` : '';

      item.detail = `Column in: ${tableList}${moreCount}${typeDisplay}`;
      const doc = new vscode.MarkdownString();
      doc.appendMarkdown(`### Column \`${colName}\`\n\n`);
      doc.appendMarkdown(
        `- **Found in tables:** \`${Array.from(info.tables).join('`, `')}\`\n`,
      );
      if (info.typeStr) {
        doc.appendMarkdown(`- **Type:** \`${info.typeStr}\`\n`);
      }
      item.documentation = doc;
      item.sortText = prioritizeColumns ? `0_${colName}` : `9_${colName}`;
      item.insertText = colName;

      allColumns.push(item);
    });

    return allColumns;
  }

  private getKeywordItems(
    driver?: string,
    context: QueryContext = 'unknown',
  ): vscode.CompletionItem[] {
    const driverKeywords =
      driver && DRIVER_KEYWORDS[driver] ? DRIVER_KEYWORDS[driver] : [];
    const contextKeywords = CONTEXT_KEYWORDS[context];
    let baseKeywords =
      contextKeywords.length > 0 ? [...contextKeywords] : [...SQL_KEYWORDS];

    if (context === 'from' || context === 'join') {
      baseKeywords.push('WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT');
    }

    const keywords = [...new Set([...baseKeywords, ...driverKeywords])];

    const driverFunctions =
      driver && DRIVER_FUNCTIONS[driver] ? DRIVER_FUNCTIONS[driver] : [];
    const coreFunctions = [
      'COUNT',
      'SUM',
      'AVG',
      'MIN',
      'MAX',
      'CAST',
      'CONVERT',
      'COALESCE',
      'NULLIF',
      'DATEADD',
      'DATEDIFF',
      'ROW_NUMBER',
      'RANK',
      'DENSE_RANK',
      'SUBSTRING',
      'REPLACE',
      'CONCAT',
      'STRING_AGG',
      'IIF',
    ];
    const functions =
      context === 'select' ||
      context === 'where' ||
      context === 'order' ||
      context === 'group'
        ? [...coreFunctions, ...driverFunctions]
        : driverFunctions;

    const functionDefinitions: Record<
      string,
      { snippet: string; doc: string }
    > = {
      COUNT: {
        snippet: 'COUNT(${1:*})',
        doc: 'Returns the number of rows or non-null values.',
      },
      SUM: {
        snippet: 'SUM(${1:expression})',
        doc: 'Calculates the total sum of a numeric column.',
      },
      AVG: {
        snippet: 'AVG(${1:expression})',
        doc: 'Calculates the average value of a numeric column.',
      },
      MIN: {
        snippet: 'MIN(${1:expression})',
        doc: 'Returns the minimum value in a column.',
      },
      MAX: {
        snippet: 'MAX(${1:expression})',
        doc: 'Returns the maximum value in a column.',
      },
      COALESCE: {
        snippet: 'COALESCE(${1:expr1}, ${2:default_val})',
        doc: 'Returns the first non-null expression.',
      },
      NULLIF: {
        snippet: 'NULLIF(${1:expr1}, ${2:expr2})',
        doc: 'Returns NULL if expr1 equals expr2.',
      },
      CAST: {
        snippet: 'CAST(${1:expression} AS ${2:DATA_TYPE})',
        doc: 'Converts an expression to a specified data type.',
      },
      CONVERT: {
        snippet: 'CONVERT(${1:DATA_TYPE}, ${2:expression})',
        doc: 'Converts an expression to a data type (MSSQL).',
      },
      ISNULL: {
        snippet: 'ISNULL(${1:check_expression}, ${2:replacement_value})',
        doc: 'Replaces NULL with a specified value (MSSQL).',
      },
      IFNULL: {
        snippet: 'IFNULL(${1:expr1}, ${2:expr2})',
        doc: 'Returns expr2 if expr1 is NULL.',
      },
      GETDATE: {
        snippet: 'GETDATE()',
        doc: 'Returns current system date and time (MSSQL).',
      },
      NOW: { snippet: 'NOW()', doc: 'Returns current date and time.' },
      DATEADD: {
        snippet: 'DATEADD(${1:datepart}, ${2:number}, ${3:date})',
        doc: 'Adds an interval to a date (MSSQL).',
      },
      DATEDIFF: {
        snippet: 'DATEDIFF(${1:datepart}, ${2:startdate}, ${3:enddate})',
        doc: 'Calculates difference between dates (MSSQL).',
      },
      DATE_TRUNC: {
        snippet: "DATE_TRUNC('${1:day}', ${2:timestamp})",
        doc: 'Truncates timestamp to specified precision.',
      },
      IIF: {
        snippet:
          'IIF(${1:boolean_expression}, ${2:true_value}, ${3:false_value})',
        doc: 'Returns one of two values depending on evaluation.',
      },
      ROW_NUMBER: {
        snippet:
          'ROW_NUMBER() OVER (PARTITION BY ${1:column} ORDER BY ${2:column})',
        doc: 'Numbers rows sequentially.',
      },
      RANK: {
        snippet: 'RANK() OVER (PARTITION BY ${1:column} ORDER BY ${2:column})',
        doc: 'Ranks rows with gaps for duplicate values.',
      },
      DENSE_RANK: {
        snippet:
          'DENSE_RANK() OVER (PARTITION BY ${1:column} ORDER BY ${2:column})',
        doc: 'Ranks rows without gaps for duplicate values.',
      },
      STRING_AGG: {
        snippet: "STRING_AGG(${1:expression}, '${2:,}')",
        doc: 'Concatenates string expressions.',
      },
      CONCAT: {
        snippet: 'CONCAT(${1:str1}, ${2:str2})',
        doc: 'Concatenates two or more strings.',
      },
      SUBSTRING: {
        snippet: 'SUBSTRING(${1:expression}, ${2:start}, ${3:length})',
        doc: 'Extracts substring from string.',
      },
      REPLACE: {
        snippet:
          'REPLACE(${1:string_expression}, ${2:pattern}, ${3:replacement})',
        doc: 'Replaces all occurrences of substring.',
      },
    };

    const keywordItems = keywords.map((k) => {
      const item = new vscode.CompletionItem(
        k,
        vscode.CompletionItemKind.Keyword,
      );
      item.detail = 'SQL Keyword';
      item.sortText = `1_${k}`;
      return item;
    });

    const functionItems = functions.map((fn) => {
      const item = new vscode.CompletionItem(
        fn,
        vscode.CompletionItemKind.Function,
      );
      item.detail = 'SQL Function';
      item.sortText = `1_${fn}`;
      const def = functionDefinitions[fn.toUpperCase()];
      if (def) {
        item.insertText = new vscode.SnippetString(def.snippet);
        item.documentation = new vscode.MarkdownString(def.doc);
      } else {
        item.insertText = new vscode.SnippetString(`${fn}($1)`);
      }
      return item;
    });

    return [...keywordItems, ...functionItems];
  }

  private getSnippets(
    context: QueryContext = 'unknown',
    driver?: string,
  ): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    const selectSnippet = new vscode.CompletionItem(
      'SELECT * FROM',
      vscode.CompletionItemKind.Snippet,
    );
    selectSnippet.insertText = new vscode.SnippetString(
      'SELECT * FROM ${1:table_name} LIMIT 10;',
    );
    selectSnippet.detail = 'Quick SELECT query';
    selectSnippet.sortText = '00_SNIPPET_SELECT';

    items.push(selectSnippet);

    if (context === 'select' && driver === 'mssql') {
      const topSnippet = new vscode.CompletionItem(
        'TOP (n)',
        vscode.CompletionItemKind.Snippet,
      );
      topSnippet.insertText = new vscode.SnippetString('TOP (${1:10})');
      topSnippet.detail = 'MSSQL TOP clause';
      topSnippet.sortText = '00_SNIPPET_TOP';
      items.push(topSnippet);
    }

    return items;
  }

  private setSortPrefix(
    items: vscode.CompletionItem[],
    prefix: string,
  ): vscode.CompletionItem[] {
    items.forEach((item) => {
      const label = item.label.toString();
      item.sortText = `${prefix}_${label}`;
    });
    return items;
  }

  private dedupeByLabel(
    items: vscode.CompletionItem[],
  ): vscode.CompletionItem[] {
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
    boostedPrefix: string,
  ): vscode.CompletionItem[] {
    const normalizedPrefix = this.normalizeName(prefix || '').toLowerCase();
    if (!normalizedPrefix) {
      return items;
    }

    items.forEach((item) => {
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

  private getTableReferences(
    text: string,
  ): Array<{ table: string; alias: string }> {
    const refs: Array<{ table: string; alias: string }> = [];
    const regex =
      /\b(from|join)\s+([^\s,]+)(?:\s+as)?(?:\s+([a-zA-Z_][\w]*))?/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const table = this.normalizeTableForLookup(match[2]);
      const aliasCandidate = match[3];
      const alias =
        aliasCandidate && !this.isClauseKeyword(aliasCandidate)
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

  private incrementUsage(
    store: Map<string, number>,
    key: string,
    delta = 1,
  ): void {
    if (!key) {
      return;
    }
    const current = store.get(key) || 0;
    store.set(key, Math.min(current + delta, 100000));
  }

  private learnUsageFromStatement(
    documentKey: string,
    statement: string,
  ): void {
    const signature = this.normalizeStatementSignature(statement);
    if (!signature || signature.length < 4) {
      return;
    }

    const prev = this.lastStatementSignatureByDocument.get(documentKey);
    if (prev === signature) {
      return;
    }

    if (this.usageByTable.size > 1000) {
      this.usageByTable.clear();
    }
    if (this.usageByColumn.size > 5000) {
      this.usageByColumn.clear();
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
    basePrefix: string,
  ): vscode.CompletionItem[] {
    items.forEach((item) => {
      const originalLabel = item.label.toString();
      const label = originalLabel.toLowerCase();
      const terminal = label.split('.').pop() || label;

      let score = 0;
      if (kind === 'table') {
        score = this.usageByTable.get(terminal) || 0;
      } else {
        score =
          (this.usageByColumn.get(label) || 0) +
          (this.usageByColumn.get(terminal) || 0);
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

    const lastJoinMatch = textBefore.match(
      /\b(LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+OUTER\s+JOIN|INNER\s+JOIN|CROSS\s+JOIN|JOIN)\b(?=[^;]*$)/i,
    );
    const joinKeyword = lastJoinMatch ? lastJoinMatch[1].toUpperCase() : 'JOIN';

    const anchor = refs[refs.length - 1];
    const usedTables = new Set(refs.map((r) => r.table.toLowerCase()));
    const snippets: vscode.CompletionItem[] = [];

    for (const fk of this.getForeignKeys()) {
      const leftTable = this.normalizeTableForLookup(fk.table);
      const rightTable = this.normalizeTableForLookup(fk.referencedTable);

      let joinTable = '';
      let leftExpr = '';
      let rightExpr = '';

      if (
        leftTable.toLowerCase() === anchor.table.toLowerCase() &&
        !usedTables.has(rightTable.toLowerCase())
      ) {
        joinTable = fk.referencedTable;
        const joinAlias = rightTable;
        leftExpr = `${anchor.alias}.${fk.column}`;
        rightExpr = `${joinAlias}.${fk.referencedColumn}`;
      } else if (
        rightTable.toLowerCase() === anchor.table.toLowerCase() &&
        !usedTables.has(leftTable.toLowerCase())
      ) {
        joinTable = fk.table;
        const joinAlias = leftTable;
        leftExpr = `${anchor.alias}.${fk.referencedColumn}`;
        rightExpr = `${joinAlias}.${fk.column}`;
      }

      if (!joinTable) {
        continue;
      }

      const joinBase = this.normalizeTableForLookup(joinTable);
      const label = `${joinKeyword} ${joinTable} ON`;
      const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Snippet,
      );
      item.detail = `Suggested by FK (${anchor.table} ↔ ${joinBase})`;
      item.sortText = `05_${label}`;
      item.insertText = new vscode.SnippetString(
        `${joinKeyword} ${joinTable} ${joinBase} ON ${leftExpr} = ${rightExpr}`,
      );
      snippets.push(item);
    }

    return this.dedupeByLabel(snippets);
  }

  private getRelatedTables(tablesInQuery: Set<string>): Set<string> {
    const related = new Set<string>();
    const fks = this.getForeignKeys();

    for (const fk of fks) {
      const tableNorm = this.normalizeTableForLookup(fk.table).toLowerCase();
      const refTableNorm = this.normalizeTableForLookup(
        fk.referencedTable,
      ).toLowerCase();

      for (const table of tablesInQuery) {
        const queryTableNorm = table.toLowerCase();
        if (queryTableNorm === tableNorm) {
          related.add(refTableNorm);
        }
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
    currentIdentifier: string,
  ): void {
    const currentId = this.normalizeName(currentIdentifier).toLowerCase();

    items.forEach((item) => {
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

function generateTableAlias(tableName: string): string {
  const parts = tableName
    .replace(/[^a-zA-Z0-9_]/g, '')
    .split('_')
    .filter(Boolean);
  if (parts.length > 1) {
    return parts.map((p) => p[0].toLowerCase()).join('');
  }
  const clean = parts[0] || tableName;
  if (clean.length <= 3) {
    return clean.toLowerCase();
  }
  return clean[0].toLowerCase();
}

export class SqlHoverProvider implements vscode.HoverProvider {
  constructor(private completionProvider: SqlCompletionItemProvider) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return null;
    }
    const word = document.getText(wordRange);

    const schema = this.completionProvider.getConsolidatedSchema();
    for (const [conn, tables] of schema) {
      for (const t of tables) {
        if (t.table.toLowerCase() === word.toLowerCase()) {
          const pkStr = t.primaryKeys?.length
            ? `\nPrimary Keys: ${t.primaryKeys.join(', ')}`
            : '';
          const fkStr = t.foreignKeys?.length
            ? `\nForeign Keys: ${t.foreignKeys.length}`
            : '';
          const msString = new vscode.MarkdownString();
          msString.appendMarkdown(`**Table**: \`${t.table}\`\n\n`);
          msString.appendMarkdown(`**Columns**:\n`);
          t.columns.forEach((c) => {
            const type = t.columnTypes?.[c] || 'unknown';
            msString.appendMarkdown(`- \`${c}\`: *${type}*\n`);
          });
          if (pkStr) {
            msString.appendMarkdown(`\n${pkStr}`);
          }
          if (fkStr) {
            msString.appendMarkdown(`${fkStr}`);
          }
          return new vscode.Hover(msString);
        }

        const cIdx = t.columns.findIndex(
          (c) => c.toLowerCase() === word.toLowerCase(),
        );
        if (cIdx !== -1) {
          const type = t.columnTypes?.[t.columns[cIdx]] || 'unknown';
          return new vscode.Hover(
            new vscode.MarkdownString(
              `**Column**: \`${t.columns[cIdx]}\`\n**Type**: *${type}*\n**Table**: \`${t.table}\``,
            ),
          );
        }
      }
    }
    return null;
  }
}

export function refreshDiagnostics(
  doc: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
  completionProvider: SqlCompletionItemProvider,
) {
  if (doc.languageId !== 'sql') {
    return;
  }
  const diagnostics: vscode.Diagnostic[] = [];
  const text = doc.getText();

  const tablesInQuery = completionProvider.getTablesInQuery(text);
  if (tablesInQuery.size === 0) {
    diagnosticCollection.set(doc.uri, []);
    return;
  }

  const schema = completionProvider.getConsolidatedSchema();
  if (schema.size === 0) {
    return;
  }

  const existingTables = new Set<string>();
  for (const [conn, tables] of schema) {
    for (const t of tables) {
      existingTables.add(t.table.toLowerCase());
    }
  }

  for (const table of tablesInQuery) {
    const lowerTable = table.toLowerCase();
    if (!existingTables.has(lowerTable)) {
      const regex = new RegExp(`\\b${table}\\b`, 'g');
      let match;
      while ((match = regex.exec(text)) !== null) {
        const startPos = doc.positionAt(match.index);
        const endPos = doc.positionAt(match.index + table.length);
        const range = new vscode.Range(startPos, endPos);
        const diagnostic = new vscode.Diagnostic(
          range,
          `Table or view '${table}' does not exist in the current schema cache.`,
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostics.push(diagnostic);
      }
    }
  }

  diagnosticCollection.set(doc.uri, diagnostics);
}
