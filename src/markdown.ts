import * as vscode from 'vscode';
import { Row, TabularResult } from './driver';

export function resultToMarkdownTable(result: TabularResult): string {
  const normalized = normalizeTabularResult(result);
  if (normalized.rows.length < 1) {
    return '*Empty Results Table*';
  }

  const columns = normalized.columns ?? Object.keys(normalized.rows[0]);
  const maxRows = getMaxRows();

  let displayResult = [...normalized.rows];

  if (displayResult.length > maxRows) {
    displayResult = displayResult.slice(0, maxRows);

    const dummyRow: Row = {};
    columns.forEach(col => {
      dummyRow[col] = '...';
    });
    displayResult.push(dummyRow);
  }

  const header = markdownHeader(columns);
  const rows = displayResult.map(row => markdownRow(row, columns)).join('\n');

  return `${header}\n${rows}`;
}

function normalizeTabularResult(result: TabularResult): { rows: Row[]; columns?: string[] } {
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const columns = Array.isArray(result.columns) ? result.columns : undefined;
    if (columns) {
      const mapped = rows.map(row => {
        if (Array.isArray(row)) {
          const obj: Row = {};
          columns.forEach((col, idx) => {
            obj[col] = row[idx];
          });
          return obj;
        }
        return row as Row;
      });
      return { rows: mapped, columns };
    }
    return { rows: rows as Row[], columns };
  }

  return { rows: result as Row[] };
}

function getMaxRows(): number {
  const fallbackMaxRows = 100;
  const maxRows: number | undefined = vscode.workspace
    .getConfiguration('SQLNotebook')
    .get('maxResultRows');
  return maxRows ?? fallbackMaxRows;
}

function serializeCell(a: any): any {
  try {
    if (a === null || a === undefined) {
      return 'NULL';
    }
    if (Buffer.isBuffer(a)) {
      return `0x${a.toString('hex')}`;
    }
    if (typeof a === 'object') {
      return JSON.stringify(a);
    }
    if (typeof a === 'string') {
      return a.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\|/g, '\\|');
    }
    return a;
  } catch {
    return String(a);
  }
}

function markdownRow(row: Row, columns: string[]): string {
  const middle = columns
    .map((colKey) => serializeCell(row[colKey]))
    .join(' | ');
  return `| ${middle} |`;
}

function markdownHeader(columns: string[]): string {
  const keys = columns.join(' | ');
  const divider = columns
    .map(() => '--')
    .join(' | ');
  return `| ${keys} |\n| ${divider} |`;
}