import * as vscode from 'vscode';
import { KernelManager } from './controller';
import { TableSchema, getStatementInfos } from './driver';

function formatSchemaForPrompt(schemas: TableSchema[]): string {
    return schemas.map(s => {
        const cols = s.columns.map(c => {
            const type = s.columnTypes?.[c] ? ` ${s.columnTypes[c]}` : '';
            return `  ${c}${type}`;
        });

        if (s.primaryKeys && s.primaryKeys.length > 0) {
            cols.push(`  PRIMARY KEY (${s.primaryKeys.join(', ')})`);
        }

        if (s.foreignKeys && s.foreignKeys.length > 0) {
            s.foreignKeys.forEach(fk => {
                cols.push(`  FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencedSchema ? fk.referencedSchema + '.' : ''}${fk.referencedTable}(${fk.referencedColumn})`);
            });
        }

        return `CREATE TABLE ${s.schema ? s.schema + '.' : ''}${s.table} (\n${cols.join(',\n')}\n);`;
    }).join('\n\n');
}

export function registerAiAssistant(context: vscode.ExtensionContext, kernelManager: KernelManager) {
    const handler: vscode.ChatRequestHandler = async (request, chatContext, response, token) => {
        const config = vscode.workspace.getConfiguration('sqlnotebook');
        const execMode = config.get<string>('ai.executionMode') || 'manual';

        response.progress('Analyzing active DB schema...');

        const activeNotebook = vscode.window.activeNotebookEditor?.notebook;
        const activeKernel = kernelManager.getKernelForNotebook(activeNotebook);

        let schemaPrompt = "No database connected at the moment.";
        let activeContextText = "";

        const editor = vscode.window.activeNotebookEditor;
        if (editor && editor.selections.length > 0) {
            const activeCell = editor.notebook.cellAt(editor.selections[0].start);
            if (activeCell && activeCell.kind === vscode.NotebookCellKind.Code) {
                activeContextText = activeCell.document.getText();
                const activeTextEditor = vscode.window.activeTextEditor;
                if (activeTextEditor && activeTextEditor.document.uri.toString() === activeCell.document.uri.toString()) {
                    if (!activeTextEditor.selection.isEmpty) {
                        activeContextText = activeTextEditor.document.getText(activeTextEditor.selection);
                    }
                }
            }
        }

        if (activeKernel) {
            try {
                const schema = await activeKernel.getSchemaOrLoad();

                let historyText = chatContext.history.map(turn => {
                    if ('prompt' in turn) {return turn.prompt;}
                    if ('response' in turn) {return turn.response.map((r: any) => {
                        return typeof r.value === 'string' ? r.value : (r.value?.value || '');
                    }).join('');}
                    return '';
                }).join(' ');

                const fullContextForSearch = (request.prompt + " " + activeContextText + " " + historyText).toLowerCase();

                const relevantSchemas = schema.filter(s => {
                    const escapedTable = s.table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b${escapedTable}\\b`, 'i');
                    return regex.test(fullContextForSearch);
                });

                const schemasToSendSet = new Set<TableSchema>(relevantSchemas);

                if (relevantSchemas.length > 0) {
                    relevantSchemas.forEach(s => {
                        s.foreignKeys?.forEach(fk => {
                            const related = schema.find(t => t.table === fk.referencedTable);
                            if (related) {schemasToSendSet.add(related);}
                        });
                    });
                    schema.forEach(s => {
                        if (s.foreignKeys?.some(fk => relevantSchemas.some(rt => rt.table === fk.referencedTable))) {
                            schemasToSendSet.add(s);
                        }
                    });
                }

                const schemasToSend = Array.from(schemasToSendSet);

                if (schemasToSend.length > 0 || schema.length <= 8) {
                    const finalSchemas = schemasToSend.length > 0 ? schemasToSend : schema;
                    schemaPrompt = "Relevant tables detailed schema (including related tables):\n" + formatSchemaForPrompt(finalSchemas);

                    const otherTables = schema.filter(s => !finalSchemas.includes(s));
                    if (otherTables.length > 0) {
                        schemaPrompt += "\n\nOther available tables (names only): " + otherTables.map(t => t.table).join(', ');
                    }
                } else {
                    schemaPrompt = "Available tables (names only): " + schema.map(t => t.table).join(', ') +
                                   "\n\n(Note: The database is large. Mention a specific table in your prompt to see its columns).";
                }
            } catch (e) {
                schemaPrompt = "Error loading database schema.";
            }
        }

        const systemPrompt = `You are an expert SQL Data Engineer.
        Your current database has this structure:

        ${schemaPrompt}

        ${activeContextText ? `The user currently has this SQL code in focus:\n\`\`\`sql\n${activeContextText}\n\`\`\`\nUse this context if they ask to optimize, fix, or explain a query.\n` : ''}
        Rules:
        - You must always assist the user with their SQL-related requests. Assume any ambiguous message is about the database schema or the queries. Never refuse to help.
        - If the user asks for a query, provide the SQL code inside a Markdown \`\`\`sql block.
        - If the user asks for multiple tables or queries, provide all the SQL statements inside a single Markdown \`\`\`sql block, separated by semicolons.
        - If the user asks a general question about the database schema, answer it conversationally.
        - Do NOT output CREATE TABLE statements unless explicitly requested.`;

        response.progress(`Querying ${request.model.name}...`);

        let fullResponse = '';
        try {
            const messages: vscode.LanguageModelChatMessage[] = [
                vscode.LanguageModelChatMessage.User(systemPrompt)
            ];

            for (const turn of chatContext.history) {
                if ('prompt' in turn) {
                    messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
                } else if ('response' in turn) {
                    const text = turn.response.map((r: any) => {
                        return typeof r.value === 'string' ? r.value : (r.value?.value || '');
                    }).join('');
                    messages.push(vscode.LanguageModelChatMessage.Assistant(text));
                }
            }

            messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

            const chatResponse = await request.model.sendRequest(messages, {}, token);
            for await (const fragment of chatResponse.text) {
                fullResponse += fragment;
            }
            fullResponse = fullResponse.trim();
        } catch (err: any) {
            response.markdown(`❌ Failed to connect to LLM: ${err.message}.`);
            return;
        }

        const sqlMatch = fullResponse.match(/```sql\s*([\s\S]*?)\s*```/i);
        const generatedSql = sqlMatch ? sqlMatch[1].trim() : '';

        if (!generatedSql) {
            response.markdown(fullResponse);
            return;
        }

        if (execMode === 'manual' || !activeNotebook) {
            response.markdown(`${fullResponse}\n\n*Note: Set executionMode to 'strict' in settings to auto-run.*`);
            return;
        }

        const statementInfos = getStatementInfos(generatedSql);
        const safeTypes = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'PRAGMA'];
        const isSafe = statementInfos.every(info => safeTypes.includes(info.type));

        if (execMode === 'strict' && !isSafe) {
            response.markdown(`❌ **Blocked by SQL Notebook Pro (Strict Mode):** The query attempts to modify data. Only safe queries (SELECT, SHOW, DESCRIBE, etc.) are allowed.\n\n\`\`\`sql\n${generatedSql}\n\`\`\``);
            return;
        }

        try {
            const edit = new vscode.WorkspaceEdit();
            const index = activeNotebook.cellCount;
            const cellData = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, generatedSql, 'sql');
            edit.set(activeNotebook.uri, [vscode.NotebookEdit.insertCells(index, [cellData])]);
            await vscode.workspace.applyEdit(edit);
            response.markdown(`✅ **Code successfully injected!** You have a new cell in your Notebook.\n\n\`\`\`sql\n${generatedSql}\n\`\`\``);

            const editor = vscode.window.activeNotebookEditor;
            if (editor && editor.notebook.uri.toString() === activeNotebook.uri.toString()) {
                editor.selection = new vscode.NotebookRange(index, index + 1);
                await vscode.commands.executeCommand('notebook.cell.execute');
            }
        } catch (e: any) {
            response.markdown(`❌ Failed to create cell in your notebook: ${e.message}\n\n\`\`\`sql\n${generatedSql}\n\`\`\``);
        }
    };

    context.subscriptions.push(vscode.chat.createChatParticipant('sqlnotebook.aiAssistant', handler));
}