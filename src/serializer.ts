import { TextDecoder, TextEncoder } from 'util';
import { embedImagesAsBase64 } from './embed-base64';
import { extractAttachmentsFromMarkdown } from './attachments-util';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const CELL_SEPARATOR = '\n\n-- %%\n\n';

const OUTPUT_START = '/*<SQL_OUTPUT>';
const OUTPUT_END = '</SQL_OUTPUT>*/';
const OUTPUT_REGEX = /\/\*<SQL_OUTPUT>([\s\S]*?)<\/SQL_OUTPUT>\*\//g;

const PARAMS_START = '/*<SQL_PARAMS>';
const PARAMS_END = '</SQL_PARAMS>*/';
const PARAMS_REGEX = /\/\*\s*<SQL_PARAMS>\s*([\s\S]*?)\s*<\/SQL_PARAMS>\s*\*\//;

const JSON_NOTEBOOK_FORMAT = 'sqlnotebook-json-v1';

type SerializedCell = {
  kind: 'markup' | 'code';
  language: string;
  value: string;
  attachments?: Record<string, Record<string, string>>;
  output?: any;
  executionSummary?: {
    executionOrder?: number;
    success?: boolean;
    timing?: {
      startTime: number;
      endTime: number;
    };
  };
};

type SerializedNotebook = {
  format: string;
  version: number;
  metadata?: {
    parameters?: Record<string, any>;
  };
  cells: SerializedCell[];
};

function getCellAttachments(cell: vscode.NotebookCellData): Record<string, Record<string, string>> {
  const direct = (cell as any).attachments;
  if (direct && typeof direct === 'object') {
    return direct as Record<string, Record<string, string>>;
  }

  const metadataAttachments = (cell as any).metadata?.attachments;
  if (metadataAttachments && typeof metadataAttachments === 'object') {
    return metadataAttachments as Record<string, Record<string, string>>;
  }

  return {};
}

function getNotebookDirectoryForSerialization(): string | undefined {
  const activeNotebook = vscode.window.activeNotebookEditor?.notebook;
  if (activeNotebook && activeNotebook.notebookType === 'sql-notebook' && activeNotebook.uri.scheme === 'file') {
    return path.dirname(activeNotebook.uri.fsPath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function parseJsonNotebook(contents: string): SerializedNotebook | undefined {
  try {
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cells)) {
      return undefined;
    }

    // Accept explicit new format and permissive object-with-cells shape for forward compatibility.
    if (typeof parsed.format === 'string' && parsed.format !== JSON_NOTEBOOK_FORMAT) {
      return undefined;
    }

    return parsed as SerializedNotebook;
  } catch {
    return undefined;
  }
}

function toNotebookDataFromJson(parsed: SerializedNotebook): vscode.NotebookData {
  const cells: vscode.NotebookCellData[] = parsed.cells.map((serializedCell) => {
    const kind = serializedCell.kind === 'markup'
      ? vscode.NotebookCellKind.Markup
      : vscode.NotebookCellKind.Code;

    const language = serializedCell.language || (kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'sql');
    const value = typeof serializedCell.value === 'string' ? serializedCell.value : '';
    const cell = new vscode.NotebookCellData(kind, value, language);

    if (serializedCell.attachments && typeof serializedCell.attachments === 'object') {
      (cell as any).attachments = serializedCell.attachments;
      cell.metadata = {
        ...(cell.metadata ?? {}),
        attachments: serializedCell.attachments
      };
    }

    if (serializedCell.output !== undefined) {
      const item = vscode.NotebookCellOutputItem.json(
        serializedCell.output,
        'application/vnd.code-sql-notebook.table+json'
      );
      cell.outputs = [new vscode.NotebookCellOutput([item])];
    }

    if (serializedCell.executionSummary) {
      cell.executionSummary = {
        executionOrder: serializedCell.executionSummary.executionOrder,
        success: serializedCell.executionSummary.success,
        timing: serializedCell.executionSummary.timing
      };
    }

    return cell;
  });

  if (cells.length === 0) {
    cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'sql'));
  }

  const data = new vscode.NotebookData(cells);
  const parameters = parsed.metadata?.parameters ?? {};
  data.metadata = { custom: { parameters } };
  return data;
}

function parseLegacyNotebook(contents: string): vscode.NotebookData {
  let workingContents = contents;
  let params = {};

  const blockMatch = workingContents.match(PARAMS_REGEX);

  if (blockMatch) {
    try {
      params = JSON.parse(blockMatch[1].trim());
      workingContents = workingContents.replace(PARAMS_REGEX, '');
    } catch (e) {
      console.error('Failed to parse params block', e);
    }
  } else {
    const lineMatch = workingContents.match(/^\s*--\s*@PARAMS:\s*(\{.*\})\s*(\r?\n)?/);
    if (lineMatch) {
      try {
        params = JSON.parse(lineMatch[1].trim());
        workingContents = workingContents.substring(lineMatch[0].length);
      } catch {
        // Ignore malformed inline params in legacy files.
      }
    }
  }

  workingContents = workingContents.trim();

  const rawCells = workingContents.split(/(?:\r?\n|^)\s*--\s*%%.*/);

  const cells = rawCells.map((rawText) => {
    let cleanText = rawText;
    let outputs: vscode.NotebookCellOutput[] = [];
    let savedSummary: vscode.NotebookCellExecutionSummary | undefined;

    const matches = [...cleanText.matchAll(OUTPUT_REGEX)];
    if (matches.length > 0) {
      const match = matches[0];
      try {
        const jsonStr = match[1].trim();
        const fullData = JSON.parse(jsonStr);

        if (fullData.summary) {
          const normalizedSummary = normalizeExecutionSummary(fullData.summary);
          if (normalizedSummary) {
            savedSummary = normalizedSummary;
          }
        }

        const item = vscode.NotebookCellOutputItem.json(
          fullData,
          'application/vnd.code-sql-notebook.table+json'
        );
        outputs = [new vscode.NotebookCellOutput([item])];
      } catch (e) {
        console.error('Error recovering output:', e);
      }
    }
    cleanText = cleanText.replace(OUTPUT_REGEX, '');

    cleanText = cleanText.trim();

    const isMarkdown = cleanText.startsWith('/*markdown');
    if (isMarkdown) {
      const mdMatch = cleanText.match(/\/\*markdown\r?\n([\s\S]*?)\r?\n\*\//);
      const attMatch = cleanText.match(/\/\*attachments\r?\n([\s\S]*?)\r?\n\*\//);
      const innerMarkdown = mdMatch ? mdMatch[1] : '';
      let attachments: Record<string, Record<string, string>> = {};
      if (attMatch) {
        try {
          attachments = JSON.parse(attMatch[1]);
        } catch {
          attachments = {};
        }
      }

      const cell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Markup,
        innerMarkdown,
        'markdown'
      );
      if (Object.keys(attachments).length > 0) {
        (cell as any).attachments = attachments;
        cell.metadata = {
          ...(cell.metadata ?? {}),
          attachments
        };
      }
      return cell;
    }

    if (cleanText.length === 0 && outputs.length === 0) {
      return null;
    }

    const cell = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Code,
      cleanText,
      'sql'
    );

    if (outputs.length > 0) {
      cell.outputs = outputs;
    }
    if (savedSummary) {
      cell.executionSummary = savedSummary;
    }

    return cell;
  }).filter((cell): cell is vscode.NotebookCellData => cell !== null);

  if (cells.length === 0) {
    cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'sql'));
  }

  const data = new vscode.NotebookData(cells);
  data.metadata = { custom: { parameters: params } };
  return data;
}

function getCellOutputPayload(cell: vscode.NotebookCellData): any {
  if (!cell.outputs || cell.outputs.length === 0) {
    return undefined;
  }

  const item = cell.outputs[0].items.find(i => i.mime === 'application/vnd.code-sql-notebook.table+json');
  if (!item) {
    return undefined;
  }

  const jsonStr = new TextDecoder().decode(item.data);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

function getCellExecutionSummary(cell: vscode.NotebookCellData): SerializedCell['executionSummary'] {
  if (!cell.executionSummary) {
    return undefined;
  }

  return normalizeExecutionSummary({
    executionOrder: cell.executionSummary.executionOrder,
    success: cell.executionSummary.success,
    timing: cell.executionSummary.timing
  });
}

function normalizeExecutionSummary(summary: any): SerializedCell['executionSummary'] {
  if (!summary || typeof summary !== 'object') {
    return undefined;
  }

  const executionOrder = typeof summary.executionOrder === 'number' ? summary.executionOrder : undefined;
  const success = typeof summary.success === 'boolean' ? summary.success : undefined;
  const timing = (summary.timing
    && typeof summary.timing.startTime === 'number'
    && typeof summary.timing.endTime === 'number')
    ? {
        startTime: summary.timing.startTime,
        endTime: summary.timing.endTime
      }
    : undefined;

  if (executionOrder === undefined && success === undefined && timing === undefined) {
    return undefined;
  }

  return { executionOrder, success, timing };
}

async function serializeNotebookCells(data: vscode.NotebookData): Promise<SerializedCell[]> {
  const notebookDir = getNotebookDirectoryForSerialization();

  return Promise.all(data.cells.map(async (cell): Promise<SerializedCell> => {
    if (cell.kind === vscode.NotebookCellKind.Markup) {
      const existingAttachments = getCellAttachments(cell);
      const embedded = await embedImagesAsBase64(cell.value, notebookDir);
      const { markdown, attachments: extractedAttachments } = extractAttachmentsFromMarkdown(embedded.markdown);
      const mergedAttachments = { ...existingAttachments, ...extractedAttachments };

      return {
        kind: 'markup',
        language: 'markdown',
        value: markdown,
        attachments: Object.keys(mergedAttachments).length > 0 ? mergedAttachments : undefined
      };
    }

    return {
      kind: 'code',
      language: 'sql',
      value: cell.value,
      output: getCellOutputPayload(cell),
      executionSummary: getCellExecutionSummary(cell)
    };
  }));
}

export async function serializeNotebookAsLegacySql(data: vscode.NotebookData): Promise<string> {
  const serializedCells = await serializeNotebookCells(data);
  const parts: string[] = [];
  const params = data.metadata?.custom?.parameters;

  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    parts.push(`${PARAMS_START}\n${JSON.stringify(params, null, 2)}\n${PARAMS_END}`);
  }

  serializedCells.forEach((cell, index) => {
    const cellParts: string[] = [];

    if (cell.kind === 'markup') {
      cellParts.push(`/*markdown\n${cell.value}\n*/`);
      if (cell.attachments && Object.keys(cell.attachments).length > 0) {
        cellParts.push(`/*attachments\n${JSON.stringify(cell.attachments, null, 2)}\n*/`);
      }
    } else {
      cellParts.push(cell.value);
    }

    if (cell.output !== undefined) {
      const outputData = cell.executionSummary
        ? { ...cell.output, summary: cell.executionSummary }
        : cell.output;
      cellParts.push(`${OUTPUT_START}\n${JSON.stringify(outputData, null, 2)}\n${OUTPUT_END}`);
    } else if (cell.kind === 'code' && cell.executionSummary) {
      cellParts.push(`${OUTPUT_START}\n${JSON.stringify({ summary: cell.executionSummary }, null, 2)}\n${OUTPUT_END}`);
    }

    parts.push(cellParts.join('\n\n'));

    if (index < serializedCells.length - 1) {
      parts.push('-- %%');
    }
  });

  return parts.join('\n\n');
}

export class SQLSerializer implements vscode.NotebookSerializer {

  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    let contents = new TextDecoder().decode(content);
    if (contents.charCodeAt(0) === 0xFEFF) {
      contents = contents.slice(1);
    }
    const trimmed = contents.trim();
    const parsedJsonNotebook = parseJsonNotebook(trimmed);
    if (parsedJsonNotebook) {
      return toNotebookDataFromJson(parsedJsonNotebook);
    }

    // Backward compatibility: read legacy -- %% format for migration window.
    return parseLegacyNotebook(contents);
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const finalOutput = await serializeNotebookAsLegacySql(data);

    return new TextEncoder().encode(finalOutput);
  }
}