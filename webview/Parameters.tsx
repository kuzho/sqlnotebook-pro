import * as React from 'react';
import { VSCodeTextField, VSCodeButton, VSCodeCheckbox } from '@vscode/webview-ui-toolkit/react';

declare const acquireVsCodeApi: () => {
  postMessage: (message: { type: string; payload: any }) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const vscode = acquireVsCodeApi();

interface Parameter {
  id: number;
  name: string;
  value: string;
}

const Parameters: React.FC = () => {
  const [parameters, setParameters] = React.useState<Parameter[]>(() => {
    const state = vscode.getState();
    return state?.parameters || [{ id: Date.now(), name: '', value: '' }];
  });

  const [useLocal, setUseLocal] = React.useState(false);
  const [hasActiveFile, setHasActiveFile] = React.useState(false);
  const [saveMessage, setSaveMessage] = React.useState('');

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
        if (message.type === 'set_parameters') {
        const { parameters: newParamsObj, useLocal: newUseLocal, hasActiveFile: newHasActiveFile } = message.payload;

        const newParamsArray = Object.entries(newParamsObj).map(([key, val], idx) => ({
          id: Date.now() + idx,
          name: key.replace(/^@/, ''),
          value: String(val)
        }));

        if (newParamsArray.length === 0) {
           newParamsArray.push({ id: Date.now(), name: '', value: '' });
        }

        setParameters(newParamsArray);
        setUseLocal(newUseLocal);
        setHasActiveFile(newHasActiveFile);
        }

        if (message.type === 'save_now_result') {
          setSaveMessage(message.payload?.message || 'Saved');
          window.clearTimeout((window as any).__sqlParamSaveTimeout);
          (window as any).__sqlParamSaveTimeout = window.setTimeout(() => {
            setSaveMessage('');
          }, 2000);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  React.useEffect(() => {
    vscode.setState({ parameters });
    vscode.postMessage({
      type: 'parameters_updated',
      payload: {
        parameters: parameters.reduce((acc, p) => {
          if (p.name) acc[`@${p.name}`] = p.value;
          return acc;
        }, {} as Record<string, string>),
        useLocal
      }
    });
  }, [parameters, useLocal]);

  const handleAddParameter = () => {
    setParameters([...parameters, { id: Date.now(), name: '', value: '' }]);
  };

  const handleRemoveParameter = (id: number) => {
    setParameters(parameters.filter(p => p.id !== id));
  };

  const handleParameterChange = (id: number, field: 'name' | 'value', newValue: string) => {
    setParameters(parameters.map(p => (p.id === id ? { ...p, [field]: newValue } : p)));
  };

  return (
    <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h4>SQL Parameters</h4>
      <p style={{ fontSize: '12px', opacity: 0.7, marginTop: '-5px', marginBottom: '2px', lineHeight: '1.4' }}>
        Define variables (e.g., <code>@myVar</code>).<br/>For <code>IN(@myVar)</code> clauses, use a comma-separated list (e.g., <code>val1,val2</code>).
      </p>

      <div style={{ display: 'flex', alignItems: 'center', marginTop: '2px', marginBottom: '2px', gap: '6px' }}>
        <VSCodeCheckbox
          checked={useLocal}
          disabled={!hasActiveFile}
          onChange={(e: any) => {
            const checked = e?.target?.checked ?? e?.detail?.checked;
            if (typeof checked === 'boolean') {
              setUseLocal(checked);
            } else {
              setUseLocal(prev => !prev);
            }
          }}
        >
          Save for active file
        </VSCodeCheckbox>
        {saveMessage && (
          <span style={{ fontSize: '11px', opacity: 0.9, color: '#4CAF50' }}>{saveMessage}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
        <VSCodeButton
          appearance="secondary"
          onClick={handleAddParameter}
          style={{ flexGrow: 1 }}
        >
          <span slot="start">➕</span>
          Add Parameter
        </VSCodeButton>
        <VSCodeButton
          appearance="icon"
          disabled={!hasActiveFile}
          title="Save now (only saves parameters if 'Save for active file' is checked)"
          onClick={() =>
            vscode.postMessage({
              type: 'save_now',
              payload: { useLocal }
            })
          }
        >
          💾
        </VSCodeButton>
      </div>

      {parameters.map((param) => (
        <div key={param.id} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
          <VSCodeTextField
            placeholder="name"
            value={param.name}
            onInput={(e: any) => handleParameterChange(param.id, 'name', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            style={{ flex: 1 }}
          >
            <span slot="start">@</span>
          </VSCodeTextField>
          <VSCodeTextField
            placeholder="value"
            value={param.value}
            onInput={(e: any) => handleParameterChange(param.id, 'value', e.target.value)}
            style={{ flex: 1 }}
          />
          <VSCodeButton
            appearance="icon"
            onClick={() => handleRemoveParameter(param.id)}
            title="Remove"
            style={{ flexShrink: 0 }}
          >
            🗑️
          </VSCodeButton>
        </div>
      ))}
    </div>
  );
};

export default Parameters;