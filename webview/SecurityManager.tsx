import * as React from 'react';
import { useState, useEffect } from 'react';

const vscode = acquireVsCodeApi();

export function SecurityManager() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isDisabled, setIsDisabled] = useState(false);
  const [isSysadmin, setIsSysadmin] = useState(false);

  const [selectedDatabase, setSelectedDatabase] = useState<string>('');
  const [mappedUser, setMappedUser] = useState<string>('');
  const [dbRoles, setDbRoles] = useState<string[]>([]);
  const [availableDbRoles, setAvailableDbRoles] = useState<string[]>([]);
  const [serverRoles, setServerRoles] = useState<string[]>([]);
  const [loadingMapping, setLoadingMapping] = useState(false);

  useEffect(() => {
    const handler = (event: any) => {
      const message = event.data;
      if (message.type === 'data') {
        setData(message.data);
        setIsDisabled(message.data.isDisabled);
        setIsSysadmin(message.data.isSysadmin); // Keep for legacy/postgres fallback

        if (message.data.serverRoles) {
          setServerRoles(
            message.data.serverRoles
              .filter((r: any) => r.isMember)
              .map((r: any) => r.name),
          );
        }

        setLoading(false);
      } else if (message.type === 'mapping_data') {
        setMappedUser(message.mappedUser);
        setDbRoles(message.roles);
        if (message.availableRoles) {
          setAvailableDbRoles(message.availableRoles);
        }
        setLoadingMapping(false);
      }
    };
    window.addEventListener('message', handler);

    vscode.postMessage({ type: 'ready' });

    return () => window.removeEventListener('message', handler);
  }, []);

  const handleSave = () => {
    if (newPassword && newPassword !== confirmPassword) {
      vscode.postMessage({ type: 'error', message: 'Passwords do not match.' });
      return;
    }
    let payload: any = {
      password: newPassword ? newPassword : null,
      isDisabled,
      isSysadmin,
      serverRoles,
    };

    if (selectedDatabase) {
      payload.mapping = {
        database: selectedDatabase,
        mappedUser: mappedUser || data.loginName, // default to login name if empty
        roles: dbRoles,
      };
    }

    vscode.postMessage({
      type: 'save',
      data: payload,
    });
  };

  const handleDatabaseChange = (e: any) => {
    const db = e.target.value;
    setSelectedDatabase(db);
    setMappedUser('');
    setDbRoles([]);
    if (db) {
      setLoadingMapping(true);
      vscode.postMessage({ type: 'load_mapping', database: db });
    }
  };

  const toggleDbRole = (role: string) => {
    setDbRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const toggleServerRole = (role: string) => {
    setServerRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  if (loading || !data) {
    return (
      <div style={{ padding: '20px', fontFamily: 'var(--vscode-font-family)' }}>
        Loading security properties...
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '20px',
        fontFamily: 'var(--vscode-font-family)',
        maxWidth: '600px',
      }}
    >
      <h2
        style={{
          borderBottom: '1px solid var(--vscode-panel-border)',
          paddingBottom: '10px',
        }}
      >
        Login Properties - {data.loginName}
      </h2>

      <div
        style={{
          marginTop: '20px',
          background: 'var(--vscode-editorWidget-background)',
          padding: '15px',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Authentication</h3>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            marginTop: '15px',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                textTransform: 'uppercase',
                marginBottom: '5px',
                opacity: 0.8,
              }}
            >
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
              }}
              placeholder="Leave blank to keep current password"
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                textTransform: 'uppercase',
                marginBottom: '5px',
                opacity: 0.8,
              }}
            >
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '6px',
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                border: '1px solid var(--vscode-input-border)',
              }}
            />
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: '20px',
          background: 'var(--vscode-editorWidget-background)',
          padding: '15px',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Status</h3>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={isDisabled}
            onChange={(e) => setIsDisabled(e.target.checked)}
          />
          Login is Disabled
        </label>
      </div>

      <div
        style={{
          marginTop: '20px',
          background: 'var(--vscode-editorWidget-background)',
          padding: '15px',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Server Roles</h3>

        {data.serverRoles && data.serverRoles.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            {data.serverRoles.map((roleObj: any) => (
              <label
                key={roleObj.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                <input
                  type="checkbox"
                  checked={serverRoles.includes(roleObj.name)}
                  onChange={() => toggleServerRole(roleObj.name)}
                />
                {roleObj.name}
              </label>
            ))}
          </div>
        ) : (
          <>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={isSysadmin}
                onChange={(e) => setIsSysadmin(e.target.checked)}
              />
              sysadmin (System Administrator)
            </label>
            <p style={{ fontSize: '12px', opacity: 0.7, marginTop: '5px' }}>
              Warning: Granting sysadmin gives full control over the database
              server.
            </p>
          </>
        )}
      </div>

      <div
        style={{
          marginTop: '20px',
          background: 'var(--vscode-editorWidget-background)',
          padding: '15px',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>User Mapping (Database Roles)</h3>
        <p style={{ fontSize: '12px', opacity: 0.7 }}>
          Map this login to a specific database and assign roles.
        </p>

        <select
          value={selectedDatabase}
          onChange={handleDatabaseChange}
          style={{
            width: '100%',
            padding: '6px',
            background: 'var(--vscode-dropdown-background)',
            color: 'var(--vscode-dropdown-foreground)',
            border: '1px solid var(--vscode-dropdown-border)',
          }}
        >
          <option value="">-- Select a database to map --</option>
          {(data.databases || []).map((db: string) => (
            <option key={db} value={db}>
              {db}
            </option>
          ))}
        </select>

        {selectedDatabase && (
          <div style={{ marginTop: '15px' }}>
            {loadingMapping ? (
              <span style={{ fontSize: '12px', opacity: 0.7 }}>
                Loading database mapping...
              </span>
            ) : (
              <>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    marginBottom: '5px',
                    opacity: 0.8,
                  }}
                >
                  Database User Name
                </label>
                <input
                  type="text"
                  value={mappedUser || data.loginName}
                  onChange={(e) => setMappedUser(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px',
                    background: 'var(--vscode-input-background)',
                    color: 'var(--vscode-input-foreground)',
                    border: '1px solid var(--vscode-input-border)',
                    marginBottom: '15px',
                  }}
                />

                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    marginBottom: '5px',
                    opacity: 0.8,
                  }}
                >
                  Database Role Membership
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                  }}
                >
                  {(availableDbRoles.length > 0
                    ? availableDbRoles
                    : dbRoles
                  ).map((role) => (
                    <label
                      key={role}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={dbRoles.includes(role)}
                        onChange={() => toggleDbRole(role)}
                      />
                      {role}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
        <button
          onClick={handleSave}
          style={{
            padding: '8px 16px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}
