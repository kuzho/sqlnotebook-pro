import * as React from 'react';
import {
  VSCodeButton,
  VSCodeTextField,
  VSCodeDropdown,
  VSCodeOption,
  VSCodeCheckbox,
} from '@vscode/webview-ui-toolkit/react';

const Form: React.FC<{
  handleSubmit: (form: HTMLFormElement) => void,
  handleTest: (form: HTMLFormElement) => void
}> = ({
  handleSubmit,
  handleTest,
}) => {
  const {
    ref: dropdownRef,
    value: driver,
    setValue: setDriver,
  } = useDropdownValue();
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { data } = event;
      switch (data.type) {
        case 'clear_form':
          formRef.current?.reset();
          setDriver('mysql');
          break;

        case 'edit_connection': {
          const config = data.data;

          setDriver(config.driver);

          setTimeout(() => {
            if(dropdownRef.current) dropdownRef.current.value = config.driver;

            const setField = (name: string, val: any) => {
               const el = formRef.current?.elements.namedItem(name) as any;
               if (!el) return;

               if (el.tagName === 'VSCODE-CHECKBOX' || el.type === 'checkbox') {
                 el.checked = !!val;
               } else {
                 el.value = val === undefined || val === null ? '' : val;
               }
            };

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

          }, 0);
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);
  }, [setDriver]);

  return (
    <form ref={formRef} style={{ display: 'grid', gridRowGap: '15px' }}>
      <TextOption label="Display Name" objectKey="displayName" />
      <TextOption label="Group / Folder (Optional)" objectKey="group" />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <label style={{ display: 'block', marginBottom: '3px' }}>
          Database Driver
        </label>
        <VSCodeDropdown name="driver" ref={dropdownRef}>
          <VSCodeOption>mysql</VSCodeOption>
          <VSCodeOption>postgres</VSCodeOption>
          <VSCodeOption>mssql</VSCodeOption>
          <VSCodeOption>sqlite</VSCodeOption>
        </VSCodeDropdown>
      </div>

      {driver !== 'sqlite' && (
        <>
          <TextOption label="Database Host" objectKey="host" />
          <TextOption label="Database Port" objectKey="port" />
          <TextOption label="Database User" objectKey="user" />
          <TextOption
            label="Database Password"
            objectKey="password"
            type="password"
            placeholder="(Leave empty to keep current password)"
          />
          <TextOption label="Database Name" objectKey="database" />
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

        <VSCodeButton
          style={{flex: 2}}
          onClick={() => formRef.current && handleSubmit(formRef.current)}
        >
          Save Connection
        </VSCodeButton>
      </div>

      <div style={{ textAlign: 'right', marginTop: '-5px' }}>
        <VSCodeButton
            appearance="icon"
            title="Clear Form"
            onClick={() => {
              formRef.current?.reset();
              setDriver('mysql');
            }}
          >
            Clear Form
        </VSCodeButton>
      </div>
    </form>
  );
};

export default Form;

function useDropdownValue() {
  const [value, setValue] = React.useState<string>('mysql');
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const { current } = ref;
    const handleChange = (e: Event) => {
        setValue((e.target as HTMLInputElement)?.value);
    };
    current?.addEventListener('change', handleChange);
    return () => current?.removeEventListener('change', handleChange);
  }, [ref.current]); // eslint-disable-line react-hooks/exhaustive-deps
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
    case 'mssql':
      return (
        <>
          <VSCodeCheckbox name="encrypt" checked>Encrypt</VSCodeCheckbox>
          <VSCodeCheckbox name="trustServerCertificate" checked>Trust Server Certificate</VSCodeCheckbox>
        </>
      );
    case 'sqlite': return <TextOption objectKey="path" label="Path" />;
  }
  return <></>;
}

const TextOption: React.FC<{ label: string; objectKey: string; type?: string; placeholder?: string; }> = ({ objectKey, label, type, placeholder }) => {
  return (
    <VSCodeTextField name={objectKey} type={type} placeholder={placeholder}>
      <span style={{ color: 'var(--vscode-editor-foreground)' }}>{label}</span>
    </VSCodeTextField>
  );
};