import * as React from 'react';
import { useState } from 'react';

export default function TableDesigner({ vscode }: { vscode: any }) {
  const [schemaName, setSchemaName] = useState('dbo');
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<any[]>([
    { id: 1, name: 'Id', type: 'int', length: '', isNull: false, isPk: true },
    {
      id: 2,
      name: '',
      type: 'varchar',
      length: '50',
      isNull: true,
      isPk: false,
    },
  ]);
  const [nextId, setNextId] = useState(3);
  const [errorMsg, setErrorMsg] = useState('');

  const addColumn = () => {
    setColumns([
      ...columns,
      {
        id: nextId,
        name: '',
        type: 'varchar',
        length: '50',
        isNull: true,
        isPk: false,
      },
    ]);
    setNextId(nextId + 1);
  };

  const removeColumn = (id: number) => {
    setColumns(columns.filter((c) => c.id !== id));
  };

  const updateColumn = (id: number, field: string, value: any) => {
    setColumns(
      columns.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    );
  };

  const handleSave = () => {
    if (!tableName.trim()) {
      setErrorMsg('Table name is required.');
      return;
    }
    const validCols = columns.filter((c) => c.name.trim() !== '');
    if (validCols.length === 0) {
      setErrorMsg('At least one valid column is required.');
      return;
    }
    setErrorMsg('');
    vscode.postMessage({
      type: 'save',
      data: {
        schema: schemaName,
        table: tableName,
        columns: validCols,
      },
    });
  };

  const inputStyle = {
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    padding: '4px 8px',
    borderRadius: '2px',
    width: '100%',
    boxSizing: 'border-box' as const,
  };

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
        Design New Table
      </h2>

      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>
            Schema Name (Optional)
          </label>
          <input
            type="text"
            value={schemaName}
            onChange={(e) => setSchemaName(e.target.value)}
            style={inputStyle}
            placeholder="dbo, public, etc."
          />
        </div>
        <div style={{ flex: 2 }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>
            Table Name *
          </label>
          <input
            type="text"
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            style={inputStyle}
            placeholder="e.g. Users"
          />
        </div>
      </div>

      <div
        style={{
          marginBottom: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0 }}>Columns</h3>
        <button
          onClick={addColumn}
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            padding: '6px 12px',
            cursor: 'pointer',
          }}
        >
          + Add Column
        </button>
      </div>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginBottom: '20px',
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: '8px',
                borderBottom: '1px solid var(--vscode-panel-border)',
              }}
            >
              Column Name
            </th>
            <th
              style={{
                textAlign: 'left',
                padding: '8px',
                borderBottom: '1px solid var(--vscode-panel-border)',
              }}
            >
              Data Type
            </th>
            <th
              style={{
                textAlign: 'left',
                padding: '8px',
                borderBottom: '1px solid var(--vscode-panel-border)',
              }}
            >
              Length/Scale
            </th>
            <th
              style={{
                textAlign: 'center',
                padding: '8px',
                borderBottom: '1px solid var(--vscode-panel-border)',
              }}
            >
              Allow Nulls
            </th>
            <th
              style={{
                textAlign: 'center',
                padding: '8px',
                borderBottom: '1px solid var(--vscode-panel-border)',
              }}
            >
              Primary Key
            </th>
            <th
              style={{
                textAlign: 'center',
                padding: '8px',
                borderBottom: '1px solid var(--vscode-panel-border)',
              }}
            ></th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col) => (
            <tr key={col.id}>
              <td
                style={{
                  padding: '8px',
                  borderBottom: '1px solid var(--vscode-panel-border)',
                }}
              >
                <input
                  type="text"
                  value={col.name}
                  onChange={(e) => updateColumn(col.id, 'name', e.target.value)}
                  style={inputStyle}
                  placeholder="column_name"
                />
              </td>
              <td
                style={{
                  padding: '8px',
                  borderBottom: '1px solid var(--vscode-panel-border)',
                }}
              >
                <select
                  value={col.type}
                  onChange={(e) => updateColumn(col.id, 'type', e.target.value)}
                  style={inputStyle}
                >
                  <option value="int">int</option>
                  <option value="bigint">bigint</option>
                  <option value="varchar">varchar</option>
                  <option value="nvarchar">nvarchar</option>
                  <option value="text">text</option>
                  <option value="datetime">datetime</option>
                  <option value="date">date</option>
                  <option value="bit">bit / boolean</option>
                  <option value="decimal">decimal</option>
                  <option value="float">float</option>
                  <option value="uniqueidentifier">
                    uniqueidentifier / uuid
                  </option>
                </select>
              </td>
              <td
                style={{
                  padding: '8px',
                  borderBottom: '1px solid var(--vscode-panel-border)',
                }}
              >
                <input
                  type="text"
                  value={col.length}
                  onChange={(e) =>
                    updateColumn(col.id, 'length', e.target.value)
                  }
                  style={inputStyle}
                  placeholder="e.g. 50, MAX, 18,2"
                  disabled={
                    ![
                      'varchar',
                      'nvarchar',
                      'char',
                      'decimal',
                      'numeric',
                    ].includes(col.type)
                  }
                />
              </td>
              <td
                style={{
                  padding: '8px',
                  borderBottom: '1px solid var(--vscode-panel-border)',
                  textAlign: 'center',
                }}
              >
                <input
                  type="checkbox"
                  checked={col.isNull}
                  onChange={(e) =>
                    updateColumn(col.id, 'isNull', e.target.checked)
                  }
                />
              </td>
              <td
                style={{
                  padding: '8px',
                  borderBottom: '1px solid var(--vscode-panel-border)',
                  textAlign: 'center',
                }}
              >
                <input
                  type="checkbox"
                  checked={col.isPk}
                  onChange={(e) => {
                    updateColumn(col.id, 'isPk', e.target.checked);
                    if (e.target.checked) updateColumn(col.id, 'isNull', false);
                  }}
                />
              </td>
              <td
                style={{
                  padding: '8px',
                  borderBottom: '1px solid var(--vscode-panel-border)',
                  textAlign: 'center',
                }}
              >
                <button
                  onClick={() => removeColumn(col.id)}
                  style={{
                    background: 'transparent',
                    color: 'var(--vscode-errorForeground)',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '16px',
                  }}
                  title="Remove Column"
                >
                  ✖
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          marginTop: '20px',
          borderTop: '1px solid var(--vscode-panel-border)',
          paddingTop: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div
          style={{ color: 'var(--vscode-errorForeground)', fontWeight: 'bold' }}
        >
          {errorMsg}
        </div>
        <button
          onClick={handleSave}
          style={{
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            padding: '8px 20px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          Save Table
        </button>
      </div>
    </div>
  );
}
