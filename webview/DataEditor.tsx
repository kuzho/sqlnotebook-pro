import * as React from 'react';
import { useState, useEffect } from 'react';

export default function DataEditor({ vscode }: { vscode: any }) {
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [primaryKeys, setPrimaryKeys] = useState<string[]>([]);
  const [tableName, setTableName] = useState<string>('');

  const [changes, setChanges] = useState<Record<number, Record<string, any>>>(
    {},
  );

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'init_data') {
        setColumns(message.data.columns);
        setRows(message.data.rows);
        setPrimaryKeys(message.data.primaryKeys || []);
        setTableName(message.data.tableName);
        setChanges({});
      } else if (message.type === 'save_success') {
        vscode.postMessage({ type: 'refresh' });
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleChange = (rowIndex: number, column: string, value: string) => {
    setChanges((prev) => {
      const newChanges = { ...prev };
      if (!newChanges[rowIndex]) newChanges[rowIndex] = {};
      newChanges[rowIndex][column] = value;
      return newChanges;
    });
  };

  const handleSave = () => {
    const payload = Object.keys(changes).map((rowIndexStr) => {
      const rowIndex = parseInt(rowIndexStr, 10);
      const originalRow = rows[rowIndex];
      const pkValues: Record<string, any> = {};
      primaryKeys.forEach((pk) => {
        pkValues[pk] = originalRow[pk];
      });
      return {
        pkValues,
        newValues: changes[rowIndex],
      };
    });

    vscode.postMessage({ type: 'save_changes', data: payload });
  };

  const handleRefresh = () => {
    vscode.postMessage({ type: 'refresh' });
  };

  if (!columns.length) {
    return <div style={{ padding: 20 }}>Loading data...</div>;
  }

  const hasChanges = Object.keys(changes).length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'var(--vscode-font-family)',
      }}
    >
      <div
        style={{
          padding: '10px',
          background: 'var(--vscode-editor-background)',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}
      >
        <h3
          style={{
            margin: '0 0 10px 0',
            color: 'var(--vscode-editor-foreground)',
          }}
        >
          Editing: {tableName}
        </h3>
        <button
          onClick={handleSave}
          disabled={!hasChanges || primaryKeys.length === 0}
          style={{
            padding: '5px 15px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            cursor: 'pointer',
            marginRight: '10px',
          }}
        >
          Save Changes
        </button>
        <button
          onClick={handleRefresh}
          style={{
            padding: '5px 15px',
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
        {primaryKeys.length === 0 && (
          <span
            style={{
              color: 'var(--vscode-errorForeground)',
              marginLeft: '10px',
            }}
          >
            Warning: Table has no Primary Key. Edits are disabled.
          </span>
        )}
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--vscode-editorWidget-background)',
        }}
      >
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            color: 'var(--vscode-editor-foreground)',
          }}
        >
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                    background:
                      'var(--vscode-editorGroupHeader-tabsBackground)',
                    textAlign: 'left',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  {c} {primaryKeys.includes(c) ? '🔑' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {columns.map((c) => {
                  const isModified =
                    changes[rIdx] && changes[rIdx][c] !== undefined;
                  const value = isModified
                    ? changes[rIdx][c]
                    : row[c] === null
                      ? ''
                      : row[c];
                  return (
                    <td
                      key={c}
                      style={{
                        border: '1px solid var(--vscode-panel-border)',
                        padding: 0,
                      }}
                    >
                      <input
                        type="text"
                        value={value ?? ''}
                        onChange={(e) => handleChange(rIdx, c, e.target.value)}
                        disabled={primaryKeys.length === 0}
                        placeholder={row[c] === null ? 'NULL' : ''}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '5px',
                          border: 'none',
                          background: isModified
                            ? 'var(--vscode-editor-findMatchHighlightBackground)'
                            : 'transparent',
                          color: 'var(--vscode-editor-foreground)',
                          outline: 'none',
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
