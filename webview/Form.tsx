import * as React from 'react';
import {
  VSCodeButton,
  VSCodeTextField,
  VSCodeDropdown,
  VSCodeOption,
  VSCodeCheckbox,
} from '@vscode/webview-ui-toolkit/react';

const DEFAULT_PORTS: { [key: string]: string } = {
  mysql: '3306',
  postgres: '5432',
  mssql: '1433',
  sqlite: '',
  trino: '8080'
};

const Form: React.FC<{
  handleSubmit: (form: HTMLFormElement, isSaveAsNew: boolean) => void,
  handleTest: (form: HTMLFormElement) => void
}> = ({
  handleSubmit,
  handleTest,
}) => {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [isEditing, setIsEditing] = React.useState(false);

  const {
    ref: dropdownRef,
    value: driver,
    setValue: setDriver,
  } = useDropdownValue((newDriver) => {
    const portField = formRef.current?.elements.namedItem('port') as HTMLInputElement;
    if (portField && DEFAULT_PORTS[newDriver] !== undefined) {
        portField.value = DEFAULT_PORTS[newDriver];
    }
  });

  const handleSmartReset = () => {
    const currentDriver = driver;
    formRef.current?.reset();
    setIsEditing(false);

    const origNameField = formRef.current?.elements.namedItem('originalName') as HTMLInputElement;
    if (origNameField) {
      origNameField.value = '';
    }

    if (dropdownRef.current) {
        dropdownRef.current.value = currentDriver;
    }
    setDriver(currentDriver);

    setTimeout(() => {
       const portField = formRef.current?.elements.namedItem('port') as HTMLInputElement;
       if(portField && DEFAULT_PORTS[currentDriver] !== undefined) {
           portField.value = DEFAULT_PORTS[currentDriver];
       }
    }, 0);
  };

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { data } = event;
      switch (data.type) {
        case 'clear_form':
          handleSmartReset();
          break;

        case 'edit_connection': {
          const config = data.data;
          setIsEditing(true);
          setDriver(config.driver);

          setTimeout(() => {
            if (dropdownRef.current) {
              dropdownRef.current.value = config.driver;
            }

            const setField = (name: string, val: any) => {
               const el = formRef.current?.elements.namedItem(name) as any;
               if (!el) {
                 return;
               }

               if (el.tagName === 'VSCODE-CHECKBOX' || el.type === 'checkbox') {
                 el.checked = !!val;
               } else {
                 el.value = val === undefined || val === null ? '' : val;
               }
            };

          setField('originalName', config.name);
            setField('displayName', config.name);
            setField('group', config.group);
            if (config.driver !== 'sqlite') {
              setField('host', config.host);
              setField('port', config.port);
              setField('user', config.user);
              setField('database', config.database);
              setField('password', '');
            } else {
               setField('path', config.path);
            }

            setField('multipleStatements', config.multipleStatements);
            setField('encrypt', config.encrypt);
            setField('trustServerCertificate', config.trustServerCertificate);
            setField('legacyTls10', config.legacyTls10);

          }, 0);
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [driver, setDriver]);

  return (
    <form ref={formRef} style={{ display: 'grid', gridRowGap: '15px' }}>
      <input type="hidden" name="originalName" />
      <TextOption label="Display Name" objectKey="displayName" />
      <TextOption label="Group / Folder (Optional)" objectKey="group" />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label style={{ display: 'block', marginBottom: '3px' }}>
          Database Driver
        </label>
        <VSCodeDropdown name="driver" ref={dropdownRef}>
          <VSCodeOption>mssql</VSCodeOption>
          <VSCodeOption>mysql</VSCodeOption>
          <VSCodeOption>postgres</VSCodeOption>
          <VSCodeOption>sqlite</VSCodeOption>
          <VSCodeOption>trino</VSCodeOption>
        </VSCodeDropdown>
      </div>

      {driver !== 'sqlite' && (
        <>
          <TextOption label="Database Host" objectKey="host" />
          <TextOption
            label="Database Port"
            objectKey="port"
            defaultValue={DEFAULT_PORTS[driver] || ''}
          />
          <TextOption label="Database User" objectKey="user" />
          <TextOption
            label="Database Password"
            objectKey="password"
            type="password"
            placeholder="(Leave empty to keep current password)"
          />
          <TextOption
            label={driver === 'trino' ? "Catalog / Schema (optional)" : "Database Name"}
            objectKey="database"
            placeholder={driver === 'trino' ? "hive/default (or leave empty for all catalogs)" : ""}
          />
        </>
      )}

      {showDriverConfig(driver)}

      <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
        <VSCodeButton
          appearance="secondary"
          style={{flex: 1}}
          onClick={() => formRef.current && handleTest(formRef.current)}
        >
          Test Connection
        </VSCodeButton>

        {isEditing && (
          <VSCodeButton
            appearance="secondary"
            style={{flex: 1}}
            onClick={() => formRef.current && handleSubmit(formRef.current, true)}
            title="Save as a new connection (duplicates this one)"
          >
            Save as New
          </VSCodeButton>
        )}

        <VSCodeButton
          style={{flex: isEditing ? 1 : 2}}
          onClick={() => formRef.current && handleSubmit(formRef.current, false)}
        >
          Save Connection
        </VSCodeButton>
      </div>

      <div style={{ textAlign: 'right', marginTop: '-5px' }}>
        <VSCodeButton
            appearance="icon"
            title="Clear Form"
            onClick={handleSmartReset}
          >
            Clear Form
        </VSCodeButton>
      </div>
    </form>
  );
};

export default Form;

function useDropdownValue(onChange?: (newVal: string) => void) {
  const [value, setValue] = React.useState<string>('mssql');
  const ref = React.useRef<any>(null);

  React.useEffect(() => {
    const { current } = ref;
    const handleChange = (e: Event) => {
        const newVal = (e.target as HTMLInputElement)?.value;
        setValue(newVal);
        if (onChange) {
          onChange(newVal);
        }
    };
    current?.addEventListener('change', handleChange);
    return () => current?.removeEventListener('change', handleChange);
  }, [ref.current, onChange]);

  return { ref, value, setValue };
}

function showDriverConfig(driver: string) {
  switch (driver) {
    case 'mysql':
      return (
        <>
          <VSCodeCheckbox name="multipleStatements" checked>Multiple statements</VSCodeCheckbox>
        </>
      );
    case 'postgres': return <></>;
    case 'trino': return <></>;
    case 'mssql':
      return (
        <>
          <VSCodeCheckbox name="encrypt" checked>Encrypt</VSCodeCheckbox>
          <VSCodeCheckbox name="trustServerCertificate">Trust Server Certificate</VSCodeCheckbox>
          <VSCodeCheckbox name="legacyTls10">Legacy TLS 1.0 (SQL Server 2012)</VSCodeCheckbox>
        </>
      );
    case 'sqlite': return <TextOption objectKey="path" label="Path" />;
  }
  return <></>;
}

const TextOption: React.FC<{ label: string; objectKey: string; type?: string; placeholder?: string; defaultValue?: string }> = ({ objectKey, label, type, placeholder, defaultValue }) => {
  return (
    <VSCodeTextField name={objectKey} type={type as any} placeholder={placeholder || ""} value={defaultValue|| ""}>
      <span style={{ color: 'var(--vscode-editor-foreground)' }}>{label}</span>
    </VSCodeTextField>
  );
};