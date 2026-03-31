// Removed FlatpickrDateField component
import * as React from 'react';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/themes/dark.css';
import {
  VSCodeTextField,
  VSCodeButton,
  VSCodeCheckbox,
  VSCodeDropdown,
  VSCodeOption
} from '@vscode/webview-ui-toolkit/react';

declare const acquireVsCodeApi: () => {
  postMessage: (message: { type: string; payload: any }) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();
const LIST_BATCH_SIZE = 40;

interface Parameter {
  id: number;
  name: string;
  value: string;
  type: 'text' | 'checkbox' | 'select' | 'date';
  checked: boolean;
  checkedValue: string;
  uncheckedValue: string;
  optionsText: string;
}

type IncomingStoredParameter = string | {
  value?: string;
  type?: 'text' | 'checkbox' | 'select' | 'date';
  options?: string[];
  checked?: boolean;
  checkedValue?: string;
  uncheckedValue?: string;
};

const unformatSqlValue = (sqlValue: string): string => {
  const trimmed = String(sqlValue || '').trim();

  // For backward compatibility, handle the old format ('val1','val2')
  let processableString = trimmed;
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    processableString = trimmed.slice(1, -1);
  }

  // This handles the new format "'val1','val2'" -> "val1,val2"
  // and also single values "'my_value'" -> "my_value"
  const items = processableString.split(',')
    .map(item => {
        const trimmedItem = item.trim();
        // remove surrounding quotes 'val1' -> val1
        if (trimmedItem.startsWith("'") && trimmedItem.endsWith("'")) {
          const dequoted = trimmedItem.slice(1, -1);
          // un-escape quotes O''Malley -> O'Malley
          return dequoted.replace(/''/g, "'");
        }
        return trimmedItem; // Fallback for malformed items
    });
    return items.join(',');
};

const Parameters: React.FC = () => {
  const [parameters, setParameters] = React.useState<Parameter[]>(() => {
    const state = vscode.getState();
    return state?.parameters || [{ id: Date.now(), name: '', value: '' }];
  });

  const [hasActiveFile, setHasActiveFile] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState('');
  const [validationMessage, setValidationMessage] = React.useState('');
  const [isDirty, setIsDirty] = React.useState(false);
  const [visibleCount, setVisibleCount] = React.useState(LIST_BATCH_SIZE);
  const [editingIds, setEditingIds] = React.useState<number[]>([]);
  const listRef = React.useRef<HTMLDivElement>(null);

  const getDefaultParam = React.useCallback((): Parameter => {
    return {
      id: Date.now(),
      name: '',
      value: '',
      type: 'text',
      checked: false,
      checkedValue: 'true',
      uncheckedValue: 'false',
      optionsText: ''
    };
  }, []);

  const toParameter = React.useCallback((key: string, rawParam: IncomingStoredParameter, index: number): Parameter => {
    if (typeof rawParam === 'string') {
      return {
        id: Date.now() + index,
        name: key.replace(/^@/, ''),
        value: unformatSqlValue(rawParam),
        type: 'text',
        checked: false,
        checkedValue: 'true',
        uncheckedValue: 'false',
        optionsText: ''
      };
    }

    let inferredType: Parameter['type'] = 'text';
    if (rawParam?.type === 'checkbox' || rawParam?.type === 'select' || rawParam?.type === 'date') {
      inferredType = rawParam.type;
    }
    const checkedValue = String(rawParam?.checkedValue ?? 'true');
    const uncheckedValue = String(rawParam?.uncheckedValue ?? 'false');
    const value = unformatSqlValue(String(rawParam?.value ?? ''));
    const options = Array.isArray(rawParam?.options) ? rawParam.options.map(v => String(v)).join(',') : '';
    const checked = typeof rawParam?.checked === 'boolean'
      ? rawParam.checked
      : value === checkedValue;

    return {
      id: Date.now() + index,
      name: key.replace(/^@/, ''),
      value,
      type: inferredType,
      checked,
      checkedValue,
      uncheckedValue,
      optionsText: options
    };
  }, []);

  const buildOutgoingParameters = React.useCallback((items: Parameter[]) => {
    return items.reduce((acc, p) => {
      if (p.name) {
        const key = `@${p.name}`;
        if (Object.prototype.hasOwnProperty.call(acc, key)) {
          return acc;
        }
        if (p.type === 'checkbox') {
          acc[key] = {
            value: p.checked ? p.checkedValue : p.uncheckedValue,
            type: 'checkbox',
            checked: p.checked,
            checkedValue: p.checkedValue,
            uncheckedValue: p.uncheckedValue
          };
        } else if (p.type === 'select') {
          const options = p.optionsText
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
          const selected = p.value || options[0] || '';
          acc[key] = {
            value: selected,
            type: 'select',
            options
          };
        } else if (p.type === 'date') {
          acc[key] = {
            value: p.value,
            type: 'date'
          };
        } else {
          // Keep text parameters in legacy string format for backward compatibility.
          acc[key] = p.value;
        }
      }
      return acc;
    }, {} as Record<string, any>);
  }, []);

  const outgoingParameters = React.useMemo(() => buildOutgoingParameters(parameters), [buildOutgoingParameters, parameters]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
        if (message.type === 'set_parameters') {
        const {
          parameters: newParamsObj,
          hasActiveFile: newHasActiveFile,
          isDirty: nextIsDirty
        } = message.payload;

        const newParamsArray = Object.entries(newParamsObj || {}).map(([key, val], idx) => toParameter(key, val as IncomingStoredParameter, idx));

        if (newParamsArray.length === 0) {
              newParamsArray.push(getDefaultParam());
        }

        setParameters(newParamsArray);
        setHasActiveFile(newHasActiveFile);
        setIsDirty(!!nextIsDirty);
        setSaveMessage('');
        setValidationMessage('');
        setEditingIds([]);
        }

        if (message.type === 'update_state') {
          const { isDirty: nextIsDirty, hasActiveFile: nextHasActiveFile } = message.payload;
          if (nextIsDirty !== undefined) {
            setIsDirty(nextIsDirty);
          }
          if (nextHasActiveFile !== undefined) {
            setHasActiveFile(nextHasActiveFile);
          }
        }

        if (message.type === 'query_execution_start') {
          setEditingIds([]);
        }

        if (message.type === 'save_now_result') {
          setSaveMessage(message.payload?.message || 'Saved');
          setIsDirty(false);
          window.clearTimeout((window as any).__sqlParamSaveTimeout);
          (window as any).__sqlParamSaveTimeout = window.setTimeout(() => {
            setSaveMessage('');
          }, 2000);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [getDefaultParam, toParameter]);

  React.useEffect(() => {
    vscode.setState({ parameters });
    vscode.postMessage({
      type: 'parameters_updated',
      payload: {
        parameters: outgoingParameters
      }
    });
  }, [outgoingParameters, parameters]);

  React.useEffect(() => {
    setVisibleCount(prev => {
      if (parameters.length <= prev) {
        return Math.max(LIST_BATCH_SIZE, parameters.length);
      }
      return prev;
    });
  }, [parameters.length]);

  const handleAddParameter = () => {
    setIsDirty(true);
    setValidationMessage('');
    setParameters([...parameters, getDefaultParam()]);
    setVisibleCount(prev => Math.max(prev + 1, LIST_BATCH_SIZE));
    window.requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  };

  const handleRemoveParameter = (id: number) => {
    setIsDirty(true);
    setValidationMessage('');
    setParameters(parameters.filter(p => p.id !== id));
  };

  const handleParameterChange = (id: number, field: keyof Parameter, newValue: string | boolean) => {
    if (field === 'name') {
      const candidate = String(newValue || '').trim();
      if (candidate) {
        const duplicated = parameters.some(p => p.id !== id && p.name.trim().toLowerCase() === candidate.toLowerCase());
        if (duplicated) {
          setValidationMessage(`Duplicate variable: @${candidate}`);
          return;
        }
      }
      setValidationMessage('');
    }

    setIsDirty(true);
    setParameters(parameters.map(p => (p.id === id ? { ...p, [field]: newValue } : p)));
  };

  const openEdit = (id: number) => {
    setEditingIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  };

  const closeEdit = (id: number) => {
    setEditingIds(prev => prev.filter(existingId => existingId !== id));
  };

  const handleTypeChange = (id: number, nextType: 'text' | 'checkbox' | 'select' | 'date') => {
    setIsDirty(true);
    setParameters(parameters.map(p => {
      if (p.id !== id) {
        return p;
      }

      if (nextType === 'checkbox') {
        return {
          ...p,
          type: 'checkbox',
          checkedValue: p.checkedValue || 'true',
          uncheckedValue: p.uncheckedValue || 'false',
          checked: p.value ? p.value === p.checkedValue : p.checked
        };
      }

      if (nextType === 'select') {
        const options = p.optionsText.split(',').map(item => item.trim()).filter(Boolean);
        return {
          ...p,
          type: 'select',
          value: p.value || options[0] || ''
        };
      }

      if (nextType === 'date') {
        // Default to current date/time if empty
        let value = p.value;
        if (!value) {
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        }
        return {
          ...p,
          type: 'date',
          value
        };
      }

      return {
        ...p,
        type: 'text'
      };
    }));
  };

  const visibleParameters = React.useMemo(
    () => parameters.slice(0, visibleCount),
    [parameters, visibleCount]
  );

  const handleListScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setVisibleCount(prev => Math.min(parameters.length, prev + LIST_BATCH_SIZE));
    }
  }, [parameters.length]);

  const typeBadge = (type: 'text' | 'checkbox' | 'select') => {
    if (type === 'checkbox') {
      return {
        style: {
          background: '#d1e7dd',
          border: '1px solid #badbcc'
        }
      };
    }
    if (type === 'select') {
      return {
        style: {
          background: '#cfe2ff',
          border: '1px solid #b6d4fe'
        }
      };
    }
    return {
      style: {
        background: '#fff3cd',
        border: '1px solid #ffecb5'
      }
    };
  };

  return (
    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', height: '100vh', boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, position: 'sticky', top: 0, zIndex: 2, background: 'var(--vscode-sideBar-background)', paddingBottom: '6px' }}>
      <h4>SQL Parameters</h4>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexShrink: 0, flexWrap: 'wrap' }}>
        <VSCodeButton
          appearance="secondary"
          onClick={handleAddParameter}
          style={{ flexGrow: 1, minWidth: '160px' }}
        >
          <span slot="start">➕</span>
          Add Parameter
        </VSCodeButton>
        <VSCodeButton
          appearance="icon"
          disabled={!hasActiveFile}
          title="Save parameters to file"
          onClick={() =>
            vscode.postMessage({
              type: 'save_now',
              payload: {}
            })
          }
        >
          💾
        </VSCodeButton>
        <span
          title={hasActiveFile ? (isDirty ? 'Unsaved parameter changes' : 'All parameter changes saved') : 'No active SQL file'}
          style={{
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.3px',
            padding: '2px 6px',
            borderRadius: '999px',
            border: hasActiveFile
              ? (isDirty ? '1px solid #ff5f56' : '1px solid #2ea043')
              : '1px solid rgba(128, 128, 128, 0.45)',
            color: hasActiveFile
              ? (isDirty ? '#ff5f56' : '#2ea043')
              : 'rgba(180, 180, 180, 0.9)',
            background: hasActiveFile
              ? (isDirty ? 'rgba(255, 95, 86, 0.14)' : 'rgba(46, 160, 67, 0.14)')
              : 'rgba(128, 128, 128, 0.12)'
          }}
        >
          {hasActiveFile ? (isDirty ? 'UNSAVED' : 'SAVED') : 'NO FILE'}
        </span>
        {saveMessage && (
          <span style={{ fontSize: '11px', opacity: 0.9, color: '#4CAF50', width: '100%' }}>{saveMessage}</span>
        )}
        {validationMessage && (
          <span style={{ fontSize: '11px', opacity: 0.95, color: '#ff5f56', width: '100%' }}>{validationMessage}</span>
        )}
      </div>
      <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '4px' }}>
        Showing {Math.min(visibleCount, parameters.length)} of {parameters.length} parameters
      </div>
      </div>

      <div
        ref={listRef}
        onScroll={handleListScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '2px', paddingTop: '2px', display: 'flex', flexDirection: 'column', gap: '8px' }}
      >
      {visibleParameters.map((param) => (
        <div
          key={param.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '6px',
            alignItems: 'start',
            padding: '6px',
            borderRadius: '6px',
            border: '1px solid rgba(128, 128, 128, 0.25)',
            background: 'rgba(128, 128, 128, 0.06)'
          }}
        >
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', width: '100%' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                background: 'rgba(128, 128, 128, 0.15)',
                border: '1px solid rgba(128, 128, 128, 0.3)'
              }}
            >
              <span>{param.name ? `@${param.name}` : '@'}</span>
              <span style={{ opacity: 0.8 }}>{param.type}</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignSelf: 'start' }}>
              {!editingIds.includes(param.id) && (
                <VSCodeButton
                  appearance="icon"
                  onClick={() => openEdit(param.id)}
                  title="Edit variable"
                  style={{ flexShrink: 0, marginTop: '2px' }}
                >
                  ✏️
                </VSCodeButton>
              )}
              {editingIds.includes(param.id) && (
                <VSCodeButton
                  appearance="icon"
                  onClick={() => closeEdit(param.id)}
                  title="Done"
                  style={{ flexShrink: 0, marginTop: '2px' }}
                >
                  ✓
                </VSCodeButton>
              )}
              <VSCodeButton
                appearance="icon"
                onClick={() => handleRemoveParameter(param.id)}
                title="Remove"
                style={{ flexShrink: 0, marginTop: '2px' }}
              >
                🗑️
              </VSCodeButton>
            </div>
          </div>

          {!editingIds.includes(param.id) && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '6px', width: '100%' }}>

              {param.type === 'text' && (
                <VSCodeTextField
                  placeholder="value"
                  value={param.value}
                  title={param.value}
                  onInput={(e: any) => handleParameterChange(param.id, 'value', e.target.value)}
                  style={{ width: '100%', minWidth: '120px' }}
                />
              )}

              {param.type === 'date' && (
                <input
                  type="datetime-local"
                  value={param.value}
                  onChange={e => handleParameterChange(param.id, 'value', e.target.value)}
                  style={{
                    width: '100%',
                    minWidth: '120px',
                    fontSize: '13px',
                    padding: '7px 10px',
                    border: '1px solid var(--vscode-input-border, #ccc)',
                    borderRadius: '4px',
                    background: 'var(--vscode-input-background, #1e1e1e)',
                    color: 'var(--vscode-input-foreground, #d4d4d4)',
                    outline: 'none',
                    boxSizing: 'border-box',
                    margin: 0
                  }}
                />
              )}

              {param.type === 'checkbox' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <VSCodeCheckbox
                    checked={param.checked}
                    onChange={(e: any) => {
                      const checked = e?.target?.checked ?? e?.detail?.checked;
                      handleParameterChange(param.id, 'checked', !!checked);
                    }}
                  >
                    On
                  </VSCodeCheckbox>
                  <span style={{ fontSize: '12px', opacity: 0.9 }}>
                    {param.checked ? param.checkedValue : param.uncheckedValue}
                  </span>
                </div>
              )}

              {param.type === 'select' && (
                <VSCodeDropdown
                  value={param.value}
                  style={{ width: '100%', minWidth: '110px' }}
                  onChange={(e: any) => handleParameterChange(param.id, 'value', String(e.target?.value || ''))}
                >
                  {param.optionsText.split(',').map((item) => item.trim()).filter(Boolean).map(option => (
                    <VSCodeOption key={option} value={option}>{option}</VSCodeOption>
                  ))}
                  {param.optionsText.split(',').map((item) => item.trim()).filter(Boolean).length === 0 && (
                    <VSCodeOption value="">No options</VSCodeOption>
                  )}
                </VSCodeDropdown>
              )}
            </div>
          )}

          {editingIds.includes(param.id) && (
            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '6px', width: '100%' }}>
              <VSCodeDropdown
                value={param.type}
                style={{ width: '100%', minWidth: '90px' }}
                onChange={(e: any) => handleTypeChange(param.id, String(e.target?.value || 'text') as 'text' | 'checkbox' | 'select' | 'date')}
              >
                <VSCodeOption value="text">Text</VSCodeOption>
                <VSCodeOption value="checkbox">Checkbox</VSCodeOption>
                <VSCodeOption value="select">Select</VSCodeOption>
                <VSCodeOption value="date">Date/Time</VSCodeOption>
              </VSCodeDropdown>
              <VSCodeTextField
                placeholder="name"
                value={param.name}
                title={param.name}
                onInput={(e: any) => handleParameterChange(param.id, 'name', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                style={{ width: '100%', minWidth: '120px' }}
              >
                <span slot="start">@</span>
              </VSCodeTextField>

              {param.type === 'text' && (
                <VSCodeTextField
                  placeholder="value"
                  value={param.value}
                  title={param.value}
                  onInput={(e: any) => handleParameterChange(param.id, 'value', e.target.value)}
                  style={{ gridColumn: '1 / -1', width: '100%', minWidth: '120px' }}
                />
              )}

              {param.type === 'checkbox' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '6px', alignItems: 'center', gridColumn: '1 / -1' }}>
                  <VSCodeTextField
                    placeholder="checked"
                    value={param.checkedValue}
                    title={param.checkedValue}
                    onInput={(e: any) => handleParameterChange(param.id, 'checkedValue', e.target.value)}
                    style={{ width: '100%' }}
                  />
                  <VSCodeTextField
                    placeholder="unchecked"
                    value={param.uncheckedValue}
                    title={param.uncheckedValue}
                    onInput={(e: any) => handleParameterChange(param.id, 'uncheckedValue', e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {param.type === 'select' && (
                <VSCodeTextField
                  placeholder="options: a,b,c"
                  value={param.optionsText}
                  title={param.optionsText}
                  onInput={(e: any) => {
                    setIsDirty(true);
                    const optionsText = e.target.value;
                    const options = optionsText.split(',').map((item: string) => item.trim()).filter(Boolean);
                    setParameters(prev => prev.map(existing => {
                      if (existing.id !== param.id) {
                        return existing;
                      }
                      const nextValue = options.includes(existing.value) ? existing.value : (options[0] || '');
                      return { ...existing, optionsText, value: nextValue };
                    }));
                  }}
                  style={{ width: '100%', minWidth: '120px', gridColumn: '1 / -1' }}
                />
              )}
            </div>
          )}
        </div>
      ))}
      {visibleCount < parameters.length && (
        <VSCodeButton
          appearance="secondary"
          onClick={() => setVisibleCount(prev => Math.min(parameters.length, prev + LIST_BATCH_SIZE))}
          style={{ width: '100%', marginTop: '4px' }}
        >
          Load more
        </VSCodeButton>
      )}
      </div>
    </div>
  );
};

export default Parameters;