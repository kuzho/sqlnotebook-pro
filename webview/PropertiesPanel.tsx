import * as React from 'react';
import { useState, useEffect } from 'react';

export default function PropertiesPanel({ vscode }: { vscode: any }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'data') {
        setData(message.data);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handler);
    };
  }, []);

  if (!data) {
    return (
      <div style={{ padding: '20px', color: 'var(--vscode-foreground)' }}>
        Loading properties...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        fontFamily: 'var(--vscode-font-family)',
        color: 'var(--vscode-foreground)',
      }}
    >
      {}
      <div
        style={{
          width: '200px',
          background: 'var(--vscode-sideBar-background)',
          borderRight: '1px solid var(--vscode-sideBar-border)',
          padding: '10px 0',
        }}
      >
        <div
          style={{
            padding: '8px 20px',
            background: 'var(--vscode-list-activeSelectionBackground)',
            color: 'var(--vscode-list-activeSelectionForeground)',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          General
        </div>
        {}
      </div>

      {}
      <div
        style={{
          flex: 1,
          padding: '20px',
          overflowY: 'auto',
          background: 'var(--vscode-editor-background)',
        }}
      >
        <h2
          style={{
            margin: '0 0 20px 0',
            borderBottom: '1px solid var(--vscode-panel-border)',
            paddingBottom: '10px',
          }}
        >
          {data.title}
        </h2>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {Object.entries(data.properties).map(([key, value]) => (
              <tr key={key}>
                <td
                  style={{
                    padding: '8px',
                    borderBottom: '1px solid var(--vscode-panel-border)',
                    fontWeight: 'bold',
                    width: '200px',
                    color: 'var(--vscode-editor-foreground)',
                  }}
                >
                  {key}
                </td>
                <td
                  style={{
                    padding: '8px',
                    borderBottom: '1px solid var(--vscode-panel-border)',
                    color: 'var(--vscode-editor-foreground)',
                  }}
                >
                  {String(value || '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
