import * as React from 'react';
import { useState, useEffect } from 'react';

export default function ImportWizard({ vscode }: { vscode: any }) {
  const [data, setData] = useState<any>(null);
  const [tableName, setTableName] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'init_data') {
        setData(message.data);
        const defaultTableName = message.data.fileName
          .replace(/\.[^/.]+$/, '')
          .replace(/[^a-zA-Z0-9_]/g, '_');
        setTableName(defaultTableName);
      } else if (message.type === 'progress') {
        setProgress(message.data);
      } else if (message.type === 'done' || message.type === 'error') {
        setImporting(false);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handler);
    };
  }, []);

  const handleImport = () => {
    if (!tableName.trim()) {
      vscode.postMessage({ type: 'error', data: 'Table name is required.' });
      return;
    }
    setImporting(true);
    setProgress('Starting import...');
    vscode.postMessage({
      type: 'import',
      data: { table: tableName },
    });
  };

  if (!data) {
    return (
      <div style={{ padding: '20px', color: 'var(--vscode-foreground)' }}>
        Loading CSV data...
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: 'var(--vscode-font-family)',
        color: 'var(--vscode-foreground)',
      }}
    >
      <h2
        style={{
          borderBottom: '1px solid var(--vscode-panel-border)',
          paddingBottom: '10px',
        }}
      >
        Import CSV Wizard
      </h2>

      <div
        style={{
          display: 'flex',
          gap: '20px',
          marginBottom: '20px',
          background: 'var(--vscode-editorWidget-background)',
          padding: '15px',
          borderRadius: '4px',
        }}
      >
        <div>
          <strong>File: </strong> {data.fileName}
        </div>
        <div>
          <strong>Total Rows (approx): </strong> {data.totalRows}
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label
          style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}
        >
          Destination Table Name *
        </label>
        <input
          type="text"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          disabled={importing}
          style={{
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border)',
            padding: '6px 10px',
            borderRadius: '2px',
            width: '100%',
            boxSizing: 'border-box' as const,
            fontSize: '14px',
          }}
          placeholder="e.g. ImportedData"
        />
        <p
          style={{
            fontSize: '12px',
            color: 'var(--vscode-descriptionForeground)',
          }}
        >
          A new table will be created with this name. All columns will be
          imported as text/varchar.
        </p>
      </div>

      <h3 style={{ margin: '20px 0 10px 0' }}>Data Preview (First 5 rows)</h3>
      <div
        style={{
          overflowX: 'auto',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {data.headers.map((h: string, i: number) => (
                <th
                  key={i}
                  style={{
                    textAlign: 'left',
                    padding: '8px',
                    background:
                      'var(--vscode-editorGroupHeader-tabsBackground)',
                    borderBottom: '1px solid var(--vscode-panel-border)',
                    borderRight: '1px solid var(--vscode-panel-border)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.preview.map((row: any, rIdx: number) => (
              <tr key={rIdx}>
                {data.headers.map((h: string, cIdx: number) => (
                  <td
                    key={cIdx}
                    style={{
                      padding: '6px 8px',
                      borderBottom: '1px solid var(--vscode-panel-border)',
                      borderRight: '1px solid var(--vscode-panel-border)',
                      color: 'var(--vscode-editor-foreground)',
                    }}
                  >
                    {row[h]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          marginTop: '30px',
          borderTop: '1px solid var(--vscode-panel-border)',
          paddingTop: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            color: 'var(--vscode-textLink-foreground)',
            fontWeight: 'bold',
          }}
        >
          {importing ? progress : ''}
        </div>
        <button
          onClick={handleImport}
          disabled={importing}
          style={{
            background: importing
              ? 'var(--vscode-button-secondaryBackground)'
              : 'var(--vscode-button-background)',
            color: importing
              ? 'var(--vscode-button-secondaryForeground)'
              : 'var(--vscode-button-foreground)',
            border: 'none',
            padding: '10px 24px',
            cursor: importing ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            borderRadius: '2px',
          }}
        >
          {importing ? 'Importing...' : 'Start Import'}
        </button>
      </div>
    </div>
  );
}
