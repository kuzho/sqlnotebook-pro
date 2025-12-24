import { TextDecoder, TextEncoder } from 'util';
import * as vscode from 'vscode';

const CELL_SEPARATOR = '\n\n-- %%\n\n';

const OUTPUT_START = '/*<SQL_OUTPUT>';
const OUTPUT_END = '</SQL_OUTPUT>*/';
const OUTPUT_REGEX = /\/\*<SQL_OUTPUT>([\s\S]*?)<\/SQL_OUTPUT>\*\//;

export class SQLSerializer implements vscode.NotebookSerializer {

  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    const contents = new TextDecoder().decode(content);

    const rawCells = contents.split(/(?:\r?\n|^)\s*--\s*%%.*/);

    const cells = rawCells.map((rawText) => {
      let cleanText = rawText;
      let outputs: vscode.NotebookCellOutput[] = [];
      let savedSummary: vscode.NotebookCellExecutionSummary | undefined;

      const match = cleanText.match(OUTPUT_REGEX);
      if (match) {
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

          cleanText = cleanText.replace(match[0], '');
        } catch (e) {
          console.error("Error recuperando output:", e);
        }
      }

      cleanText = cleanText.trim();

      const isMarkdown = cleanText.startsWith('/*markdown') && cleanText.endsWith('*/');
      if (isMarkdown) {
        const lines = cleanText.split(/\r?\n/);
        const innerMarkdown = lines.length > 2
          ? lines.slice(1, lines.length - 1).join('\n')
          : '';
        return new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          innerMarkdown,
          'markdown'
        );
      }

      if (cleanText.length === 0 && outputs.length === 0) {
         return null;
      }

      const cell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        cleanText,
        'sql'
      );

      if (outputs.length > 0) cell.outputs = outputs;
      if (savedSummary) cell.executionSummary = savedSummary;

      return cell;

    }).filter((cell): cell is vscode.NotebookCellData => cell !== null);

    if (cells.length === 0) {
      cells.push(new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'sql'));
    }

    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const contents = data.cells
      .map((cell) => {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
           return `/*markdown\n${cell.value}\n*/`;
        }

        let text = cell.value.trim();

        if (cell.outputs && cell.outputs.length > 0) {
            const item = cell.outputs[0].items.find(i => i.mime === 'application/vnd.code-sql-notebook.table+json');

            if (item) {
                const jsonStr = new TextDecoder().decode(item.data);
                let fullData;
                try {
                    fullData = JSON.parse(jsonStr);
                } catch(e) { fullData = {}; }

                if (cell.executionSummary) {
                    fullData.summary = {
                        executionOrder: cell.executionSummary.executionOrder,
                        success: cell.executionSummary.success,
                        timing: cell.executionSummary.timing
                    };
                }

                const safeJson = JSON.stringify(fullData, null, 2).replace(/\*\//g, '* /');
                text += `\n\n${OUTPUT_START}\n${safeJson}\n${OUTPUT_END}`;
            }
        }
        return text;
      })
      .filter(text => text.length > 0)
      .join(CELL_SEPARATOR);

    return new TextEncoder().encode(contents);
  }
}