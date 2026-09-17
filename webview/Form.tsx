import * as React from 'react';
import {
  VSCodeButton,
  VSCodeTextField,
  VSCodeDropdown,
  VSCodeOption,
  VSCodeCheckbox,
} from '@vscode/webview-ui-toolkit/react';

declare const acquireVsCodeApi: () => {
  postMessage: (message: { type: string; payload?: any; data?: any }) => void;
  getState: () => any;
  setState: (state: any) => void;
};

const DEFAULT_PORTS: { [key: string]: string } = {
  mysql: '3306',
  postgres: '5432',
  mssql: '1433',
  sqlite: '',
  trino: '8080',
};

interface FormState {
  originalName: string;
  displayName: string;
  group: string;
  driver: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  path: string;
  multipleStatements: boolean;
  encrypt: boolean;
  trustServerCertificate: boolean;
  legacyTls10: boolean;
  enableSsh: boolean;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  sshKey: string;
  sshPassword?: string;
}

const initialFormState: FormState = {
  originalName: '',
  displayName: '',
  group: '',
  driver: 'mssql',
  host: '',
  port: '1433',
  user: '',
  password: '',
  database: '',
  path: '',
  multipleStatements: true,
  encrypt: true,
  trustServerCertificate: false,
  legacyTls10: false,
  enableSsh: false,
  sshHost: '',
  sshPort: '22',
  sshUser: '',
  sshKey: '',
  sshPassword: '',
};

const Form: React.FC<{
  vscode: { postMessage: (msg: any) => void };
  handleSubmit: (form: HTMLFormElement, isSaveAsNew: boolean) => void;
  handleTest: (form: HTMLFormElement) => void;
}> = ({ vscode, handleSubmit, handleTest }) => {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [formData, setFormData] = React.useState<FormState>(initialFormState);

  const updateField = <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleDriverChange = (newDriver: string) => {
    setFormData((prev) => ({
      ...prev,
      driver: newDriver,
      port:
        DEFAULT_PORTS[newDriver] !== undefined
          ? DEFAULT_PORTS[newDriver]
          : prev.port,
    }));
  };

  const handleSmartReset = () => {
    setIsEditing(false);
    setFormData({
      ...initialFormState,
      driver: formData.driver,
      port: DEFAULT_PORTS[formData.driver] || '',
    });
  };

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { data } = event;
      if (!data) return;

      switch (data.type) {
        case 'clear_form':
          handleSmartReset();
          break;
        case 'edit_connection': {
          const config = data.data;
          if (!config) break;

          const driver = config.driver || 'mssql';
          setIsEditing(true);
          setFormData({
            originalName: config.name || '',
            displayName: config.name || '',
            group: config.group || '',
            driver,
            host: config.host || '',
            port:
              config.port !== undefined && config.port !== null
                ? String(config.port)
                : DEFAULT_PORTS[driver] || '',
            user: config.user || '',
            password: '',
            database: config.database || '',
            path: config.path || '',
            multipleStatements:
              config.multipleStatements !== undefined
                ? !!config.multipleStatements
                : true,
            encrypt:
              config.encrypt !== undefined ? !!config.encrypt : true,
            trustServerCertificate: !!config.trustServerCertificate,
            legacyTls10: !!config.legacyTls10,
            enableSsh: !!config.enableSsh,
            sshHost: config.sshHost || '',
            sshPort: config.sshPort !== undefined && config.sshPort !== null ? String(config.sshPort) : '22',
            sshUser: config.sshUser || '',
            sshKey: config.sshKey || '',
            sshPassword: '',
          });
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    vscode?.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  return (
    <form ref={formRef} style={{ display: 'grid', gridRowGap: '15px' }}>
      <input type="hidden" name="originalName" value={formData.originalName} />

      <TextOption
        label="Display Name"
        objectKey="displayName"
        value={formData.displayName}
        onChange={(val) => updateField('displayName', val)}
      />

      <TextOption
        label="Group / Folder (Optional)"
        objectKey="group"
        value={formData.group}
        onChange={(val) => updateField('group', val)}
      />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label style={{ display: 'block', marginBottom: '3px' }}>
          Database Driver
        </label>
        <VSCodeDropdown
          name="driver"
          value={formData.driver}
          onChange={(e: any) => handleDriverChange(e.target.value)}
        >
          <VSCodeOption value="mssql">mssql</VSCodeOption>
          <VSCodeOption value="mysql">mysql</VSCodeOption>
          <VSCodeOption value="postgres">postgres</VSCodeOption>
          <VSCodeOption value="sqlite">sqlite</VSCodeOption>
          <VSCodeOption value="trino">trino</VSCodeOption>
        </VSCodeDropdown>
      </div>

      {formData.driver !== 'sqlite' && (
        <>
          <TextOption
            label="Database Host"
            objectKey="host"
            value={formData.host}
            onChange={(val) => updateField('host', val)}
          />
          <TextOption
            label="Database Port"
            objectKey="port"
            value={formData.port}
            onChange={(val) => updateField('port', val)}
          />
          <TextOption
            label="Database User"
            objectKey="user"
            value={formData.user}
            onChange={(val) => updateField('user', val)}
          />
          <TextOption
            label="Database Password"
            objectKey="password"
            type="password"
            placeholder="(Leave empty to keep current password)"
            value={formData.password}
            onChange={(val) => updateField('password', val)}
          />
          <TextOption
            label={
              formData.driver === 'trino'
                ? 'Catalog / Schema (optional)'
                : 'Database Name'
            }
            objectKey="database"
            placeholder={
              formData.driver === 'trino'
                ? 'hive/default (or leave empty for all catalogs)'
                : ''
            }
            value={formData.database}
            onChange={(val) => updateField('database', val)}
          />

          <VSCodeCheckbox
            name="enableSsh"
            checked={formData.enableSsh}
            onChange={(e: any) => updateField('enableSsh', e.target.checked)}
          >
            Enable SSH Tunneling
          </VSCodeCheckbox>

          {formData.enableSsh && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', paddingLeft: '15px', borderLeft: '2px solid var(--vscode-focusBorder)' }}>
              <TextOption
                label="SSH Host"
                objectKey="sshHost"
                value={formData.sshHost}
                onChange={(val) => updateField('sshHost', val)}
              />
              <TextOption
                label="SSH Port"
                objectKey="sshPort"
                value={formData.sshPort}
                onChange={(val) => updateField('sshPort', val)}
              />
              <TextOption
                label="SSH User"
                objectKey="sshUser"
                value={formData.sshUser}
                onChange={(val) => updateField('sshUser', val)}
              />
              <TextOption
                label="SSH Private Key File Path (Optional)"
                objectKey="sshKey"
                placeholder="e.g. C:\Users\name\.ssh\id_rsa"
                value={formData.sshKey}
                onChange={(val) => updateField('sshKey', val)}
              />
              <TextOption
                label="SSH Password / Key Passphrase"
                objectKey="sshPassword"
                type="password"
                placeholder="(Leave empty to keep current password)"
                value={formData.sshPassword || ''}
                onChange={(val) => updateField('sshPassword', val)}
              />
            </div>
          )}
        </>
      )}

      {showDriverConfig(formData, updateField)}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          marginTop: '12px',
        }}
      >
        <VSCodeButton
          style={{ width: '100%' }}
          onClick={() =>
            formRef.current && handleSubmit(formRef.current, false)
          }
        >
          <span slot="start">💾</span>
          {isEditing ? 'Update Connection' : 'Save Connection'}
        </VSCodeButton>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <VSCodeButton
            appearance="secondary"
            style={{ flex: '1 1 110px' }}
            onClick={() => formRef.current && handleTest(formRef.current)}
          >
            <span slot="start">⚡</span>
            Test Connection
          </VSCodeButton>

          <VSCodeButton
            appearance="secondary"
            style={{ flex: '1 1 110px' }}
            onClick={() =>
              formRef.current && handleSubmit(formRef.current, true)
            }
            title="Save as a new connection (duplicates or reuses current credentials with a new name/host)"
          >
            <span slot="start">➕</span>
            Save as New
          </VSCodeButton>

          <VSCodeButton
            appearance="secondary"
            style={{ flex: '1 1 70px' }}
            title="Reset form fields to default"
            onClick={handleSmartReset}
          >
            <span slot="start">🧹</span>
            Clear
          </VSCodeButton>
        </div>
      </div>
    </form>
  );
};

export default Form;

function showDriverConfig(
  formData: FormState,
  updateField: <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => void,
) {
  switch (formData.driver) {
    case 'mysql':
      return (
        <VSCodeCheckbox
          name="multipleStatements"
          checked={formData.multipleStatements}
          onChange={(e: any) =>
            updateField('multipleStatements', e.target.checked)
          }
        >
          Multiple statements
        </VSCodeCheckbox>
      );
    case 'postgres':
    case 'trino':
      return null;
    case 'mssql':
      return (
        <>
          <VSCodeCheckbox
            name="encrypt"
            checked={formData.encrypt}
            onChange={(e: any) => updateField('encrypt', e.target.checked)}
          >
            Encrypt
          </VSCodeCheckbox>
          <VSCodeCheckbox
            name="trustServerCertificate"
            checked={formData.trustServerCertificate}
            onChange={(e: any) =>
              updateField('trustServerCertificate', e.target.checked)
            }
          >
            Trust Server Certificate
          </VSCodeCheckbox>
          <VSCodeCheckbox
            name="legacyTls10"
            checked={formData.legacyTls10}
            onChange={(e: any) => updateField('legacyTls10', e.target.checked)}
          >
            Legacy TLS 1.0 (SQL Server 2012)
          </VSCodeCheckbox>
        </>
      );
    case 'sqlite':
      return (
        <TextOption
          objectKey="path"
          label="Path"
          value={formData.path}
          onChange={(val) => updateField('path', val)}
        />
      );
  }
  return null;
}

const TextOption: React.FC<{
  label: string;
  objectKey: keyof FormState;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (val: string) => void;
}> = ({ objectKey, label, type, placeholder, value, onChange }) => {
  return (
    <VSCodeTextField
      name={objectKey}
      type={type as any}
      placeholder={placeholder || ''}
      value={value}
      onInput={(e: any) => onChange(e.target.value)}
    >
      <span style={{ color: 'var(--vscode-editor-foreground)' }}>{label}</span>
    </VSCodeTextField>
  );
};
