import * as React from 'react';
import { useState, useEffect } from 'react';

export default function ActivityMonitor({ vscode }: { vscode: any }) {
  const [processes, setProcesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProcess, setSelectedProcess] = useState<any | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'data') {
        setProcesses(message.data);
        setLoading(false);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });

    const intervalId = setInterval(() => {
      vscode.postMessage({ type: 'refresh' });
    }, 5000);

    return () => {
      window.removeEventListener('message', handler);
      clearInterval(intervalId);
    };
  }, []);

  const handleKill = (spid: number) => {
    vscode.postMessage({ type: 'kill_process', data: spid });
  };

  const handleRefresh = () => {
    setLoading(true);
    vscode.postMessage({ type: 'refresh' });
  };

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
          display: 'flex',
          alignItems: 'center',
          gap: '15px',
        }}
      >
        <h3 style={{ margin: 0, color: 'var(--vscode-editor-foreground)' }}>
          Activity Monitor (Active Processes)
        </h3>
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
          Refresh Now
        </button>
        {loading && (
          <span style={{ color: 'var(--vscode-descriptionForeground)' }}>
            Refreshing...
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
              {[
                'Action',
                'Session ID',
                'Status',
                'Login',
                'Host',
                'Database',
                'Command',
                'CPU Time',
                'Elapsed (ms)',
                'Wait Type',
                'Blocking',
              ].map((c) => (
                <th
                  key={c}
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '8px',
                    background:
                      'var(--vscode-editorGroupHeader-tabsBackground)',
                    textAlign: 'left',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processes.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={11}
                  style={{ padding: '10px', textAlign: 'center' }}
                >
                  No active user processes found.
                </td>
              </tr>
            )}
            {processes.map((p, idx) => (
              <tr
                key={idx}
                onClick={() => setSelectedProcess(p)}
                style={{
                  cursor: 'pointer',
                  background:
                    selectedProcess?.session_id === p.session_id
                      ? 'var(--vscode-list-activeSelectionBackground)'
                      : 'transparent',
                  color:
                    selectedProcess?.session_id === p.session_id
                      ? 'var(--vscode-list-activeSelectionForeground)'
                      : 'var(--vscode-foreground)',
                }}
              >
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                    textAlign: 'center',
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleKill(p.session_id);
                    }}
                    style={{
                      background: 'var(--vscode-errorForeground)',
                      color: 'white',
                      border: 'none',
                      padding: '2px 8px',
                      cursor: 'pointer',
                      borderRadius: '3px',
                    }}
                    title="Kill Process"
                  >
                    KILL
                  </button>
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.session_id}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.status}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.login_name}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.host_name}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.database_name}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.command}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.cpu_time}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.total_elapsed_time}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.wait_type}
                </td>
                <td
                  style={{
                    border: '1px solid var(--vscode-panel-border)',
                    padding: '5px',
                  }}
                >
                  {p.blocking_session_id &&
                  p.blocking_session_id !== 0 &&
                  p.blocking_session_id !== '0'
                    ? p.blocking_session_id
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedProcess && selectedProcess.sql_text && (
        <div
          style={{
            height: '30%',
            borderTop: '2px solid var(--vscode-panel-border)',
            padding: '10px',
            background: 'var(--vscode-editor-background)',
            overflowY: 'auto',
          }}
        >
          <h4 style={{ margin: '0 0 10px 0' }}>
            SQL Text (Session {selectedProcess.session_id})
          </h4>
          <pre
            style={{
              margin: 0,
              color: 'var(--vscode-textPreformat-foreground)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {selectedProcess.sql_text}
          </pre>
        </div>
      )}
    </div>
  );
}
