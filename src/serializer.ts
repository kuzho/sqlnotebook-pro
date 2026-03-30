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
          savedSummary = {
            executionOrder: fullData.summary.executionOrder,
            success: fullData.summary.success,
            timing: fullData.summary.timing
          };
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
    // Save in JSON v1 format; legacy parser remains for reading old files.
    const notebookDir = getNotebookDirectoryForSerialization();
    const embeddedSourceFiles = new Set<string>();
    const cellPromises = data.cells.map(async (cell): Promise<SerializedCell> => {
      if (cell.kind === vscode.NotebookCellKind.Markup) {
        const existingAttachments = getCellAttachments(cell);
        const embedded = await embedImagesAsBase64(cell.value, notebookDir);
        for (const filePath of embedded.embeddedFiles) {
          embeddedSourceFiles.add(filePath);
        }
        const { markdown, attachments: extractedAttachments } = extractAttachmentsFromMarkdown(embedded.markdown);
        const mergedAttachments = { ...existingAttachments, ...extractedAttachments };

        return {
          kind: 'markup',
          language: 'markdown',
          value: markdown,
          attachments: Object.keys(mergedAttachments).length > 0 ? mergedAttachments : undefined
        };
      }

      let outputPayload: any = undefined;
      let executionSummary: SerializedCell['executionSummary'] = undefined;

      if (cell.outputs && cell.outputs.length > 0) {
        const item = cell.outputs[0].items.find(i => i.mime === 'application/vnd.code-sql-notebook.table+json');
        if (item) {
          const jsonStr = new TextDecoder().decode(item.data);
          let fullData: any;
          try {
            fullData = JSON.parse(jsonStr);
          } catch {
            fullData = {};
          }
          outputPayload = fullData;
        }
      }

      if (cell.executionSummary) {
        executionSummary = {
          executionOrder: cell.executionSummary.executionOrder,
          success: cell.executionSummary.success,
          timing: cell.executionSummary.timing
        };
      }

      return {
        kind: 'code',
        language: 'sql',
        value: cell.value,
        output: outputPayload,
        executionSummary
      };
    });
    const serializedCells = await Promise.all(cellPromises);

    const notebookJson: SerializedNotebook = {
      format: JSON_NOTEBOOK_FORMAT,
      version: 1,
      metadata: {},
      cells: serializedCells
    };

    const params = data.metadata?.custom?.parameters;
    if (params && Object.keys(params).length > 0) {
      notebookJson.metadata = {
        ...(notebookJson.metadata ?? {}),
        parameters: params
      };
    }

    const finalOutput = JSON.stringify(notebookJson, null, 2);

    const output = new TextEncoder().encode(finalOutput);
    // Limpieza de imágenes pegadas ya no es necesaria; todo se embebe automáticamente.

    return output;
  }
}