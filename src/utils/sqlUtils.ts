
export function splitSqlBatches(sql: string): string[] {
  const goRegex = /^\s*GO\s*$/gim;
  return sql
    .split(goRegex)
    .map(batch => batch.trim())
    .filter(batch => batch.length > 0);
}

export function compactFormattedSql(sql: string, language: string): string {
  if (language === 'tsql') {
    sql = sql.replace(/\bWITH\s*\n\s*\(NOLOCK\)/gi, 'WITH (NOLOCK)');
    sql = sql.replace(/\s*\n\s*WITH\s*\(\s*NOLOCK\s*\)/gi, ' WITH (NOLOCK)');
  }

  sql = sql.replace(/\s*\n\s*AS\s*\n\s*/gi, ' AS ');
  sql = sql.replace(/\bAS\s*\n\s*([@a-zA-Z0-9_\[\]"`']+)/gi, ' AS $1');
  sql = sql.replace(/([@a-zA-Z0-9_\[\]"`']+)\s*\n\s*AS\b/gi, '$1 AS');

  sql = sql.replace(/\b(COUNT|SUM|MAX|MIN|AVG|ISNULL|COALESCE|CAST|CONVERT|IFNULL|DATETIME|STRFTIME)\s*\(\s*\n\s*([^)\n]+)\s*\n\s*\)/gi, '$1($2)');

  sql = sql.replace(/\bOVER\s*\([\s\S]*?\)/gi, match => match.replace(/\s+/g, ' '));
  sql = sql.replace(/\bCASE\s*\n\s*WHEN\b/gi, 'CASE WHEN');
  sql = sql.replace(/\bWITH\s*\n\s*(?!\()/gi, 'WITH ');
  sql = sql.replace(/\bAS\s*\(\s*\n\s*SELECT\b/gi, 'AS (SELECT ');
  sql = sql.replace(/\bSELECT\s+DISTINCT\s*\n\s*/gi, 'SELECT DISTINCT ');
  sql = sql.replace(/\bSELECT\s*\n\s*/gi, 'SELECT ');

  let prevSql: string;
  do {
    prevSql = sql;
    sql = sql.replace(/\(\s*\n([\s\S]*?)\n\s*\)/gi, (match, inner) => {
      const stripped = match.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
      if (stripped.includes('--') || stripped.includes('/*')) { return match; }

      const opens = (stripped.match(/\(/g) || []).length;
      const closes = (stripped.match(/\)/g) || []).length;
      if (opens !== closes) { return match; }

      if (/\b(SELECT|FROM|JOIN|WHERE|GROUP BY|ORDER BY|HAVING|INSERT|UPDATE|DELETE)\b/i.test(inner)) { return match; }

      const compacted = inner.replace(/\s*\n\s*/g, ' ').trim();
      if (compacted.length <= 120) { return `(${compacted})`; }
      return match;
    });
  } while (sql !== prevSql);

  sql = sql
    .replace(/\n{2,}/g, '\n')
    .replace(/\bSET\s*\n\s*/gi, 'SET ')
    .replace(/\bFROM\s*\n\s*/gi, 'FROM ')
    .replace(/\bWHERE\s*\n\s*/gi, 'WHERE ')
    .replace(/\b(INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL OUTER JOIN|CROSS JOIN|JOIN)\s*\n\s*/gi, '$1 ')
    .replace(/\bORDER BY\s*\n\s*/gi, 'ORDER BY ')
    .replace(/\bGROUP BY\s*\n\s*/gi, 'GROUP BY ')
    .replace(/\bHAVING\s*\n\s*/gi, 'HAVING ');

  sql = sql.replace(/\b(ORDER BY|GROUP BY)\s+([\s\S]*?)(?=\b(?:LIMIT|OFFSET|HAVING|FOR|OPTION|;|$))/gi, match => match.replace(/,\s*\n\s*/g, ', '));

  sql = sql.replace(/\b(JOIN\s+[\w\[\]"`'.]+(?:(?:\s+AS)?\s+[\w\[\]"`']*)?)\s*\n\s*ON\b/gi, '$1 ON');

  if (language === 'tsql') {
    sql = sql.replace(/\bOPTION\s*\n?\s*\(([^)]+)\)/gi, (_m, inner) => `OPTION (${inner.replace(/\s+/g, ' ').trim()})`);
  }

  sql = sql.replace(/\bIN\s*\(\s*\n([\s\S]*?)\s*\)/gi, (_m, inner) => {
    const items = inner.split('\n').map((s: string) => s.trim().replace(/,+$/, '')).filter(Boolean).join(', ');
    if (items.length < 100) {return `IN (${items})`;}
    return _m;
  });

  if (language === 'tsql') {
    sql = styleTsqlControlFlow(sql);
    sql = reindentTsqlByContext(sql);
  } else {
    sql = reindentGeneral(sql);
  }

  return sql.trim();
}

function styleTsqlControlFlow(sql: string): string {
  const lines = sql.split('\n');
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
    const next2 = i + 2 < lines.length ? lines[i + 2].trim() : '';

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    if (/^IF\b/i.test(trimmed) && /^BEGIN$/i.test(next)) {
      output.push(`${line.replace(/\s+$/, '')} BEGIN`);
      i += 1;
      continue;
    }

    if (/^ELSE$/i.test(trimmed) && /^BEGIN$/i.test(next)) {
      const indent = line.match(/^\s*/)?.[0] ?? '';
      output.push(`${indent}ELSE BEGIN`);
      i += 1;
      continue;
    }

    if (/^END$/i.test(trimmed) && /^ELSE$/i.test(next) && /^BEGIN$/i.test(next2)) {
      const indent = line.match(/^\s*/)?.[0] ?? '';
      output.push(`${indent}END ELSE BEGIN`);
      i += 2;
      continue;
    }

    if (/^END$/i.test(trimmed) && /^ELSE\s+BEGIN$/i.test(next)) {
      const indent = line.match(/^\s*/)?.[0] ?? '';
      output.push(`${indent}END ELSE BEGIN`);
      i += 1;
      continue;
    }

    output.push(line);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function reindentTsqlByContext(sql: string): string {
  const lines = sql.split('\n');
  const output: string[] = [];
  const stack: Array<'BEGIN' | 'CASE'> = [];

  const makeIndent = (level: number): string => '\t'.repeat(Math.max(level, 0));

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    const leading = rawLine.match(/^\s*/)?.[0] || '';
    const existingLevel = (leading.match(/\t/g) || []).length + Math.floor((leading.match(/ /g) || []).length / 2);
    const contextLevel = stack.filter(x => x === 'BEGIN').length;

    if (/^END\b/i.test(trimmed)) {
      if (stack.length > 0) {
        stack.pop();
      }
      const levelAfterPop = stack.filter(x => x === 'BEGIN').length;
      output.push(`${makeIndent(levelAfterPop + existingLevel)}${trimmed}`);
      if (/^END\s+ELSE\s+BEGIN$/i.test(trimmed)) {
        stack.push('BEGIN');
      }
      continue;
    }

    output.push(`${makeIndent(contextLevel + existingLevel)}${trimmed}`);

    if (/^IF\b[\s\S]*\bBEGIN$/i.test(trimmed) || /^BEGIN$/i.test(trimmed) || /^ELSE\s+BEGIN$/i.test(trimmed)) {
      stack.push('BEGIN');
    } else if (/^CASE\b/i.test(trimmed)) {
      stack.push('CASE');
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function reindentGeneral(sql: string): string {
  const lines = sql.split('\n');
  const output: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }
    output.push(rawLine);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
