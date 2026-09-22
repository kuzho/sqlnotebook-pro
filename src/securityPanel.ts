import * as vscode from 'vscode';
import { ConnData } from './connections';
import {
  getPool,
  escapeLiteral,
  normalizeRows,
  escapeIdentifier,
} from './driver';

export class SecurityPanel {
  public static currentPanel: SecurityPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _config: ConnData;
  private _loginName: string;

  public static async createOrShow(
    extensionUri: vscode.Uri,
    config: ConnData,
    loginName: string,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SecurityPanel.currentPanel) {
      SecurityPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'securityPanel',
      `Login Properties - ${loginName}`,
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    SecurityPanel.currentPanel = new SecurityPanel(
      panel,
      extensionUri,
      config,
      loginName,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    config: ConnData,
    loginName: string,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._config = config;
    this._loginName = loginName;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            await this._loadData();
            break;
          case 'load_mapping':
            await this._loadMapping(message.database);
            break;
          case 'save':
            await this._saveData(message.data);
            break;
          case 'error':
            vscode.window.showErrorMessage(message.message);
            break;
        }
      },
      null,
      this._disposables,
    );

    this._update();
  }

  public dispose() {
    SecurityPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _loadData() {
    try {
      const pool = await getPool(this._config);
      const conn = await pool.getConnection();

      let isDisabled = false;
      let isSysadmin = false;
      let databases: string[] = [];
      let serverRoles: { name: string; isMember: boolean }[] = [];

      try {
        if (this._config.driver === 'mssql') {
          const res = await conn.query(`
            SELECT is_disabled
            FROM sys.server_principals
            WHERE name = '${escapeLiteral(this._loginName)}'
          `);
          const rows = normalizeRows(res);
          if (rows && rows.length > 0) {
            isDisabled = !!(Array.isArray(rows[0])
              ? rows[0][0]
              : rows[0].is_disabled);
          }

          const roleRes = await conn.query(`
            SELECT IS_SRVROLEMEMBER('sysadmin', '${escapeLiteral(this._loginName)}') as is_sysadmin
          `);
          const roleRows = normalizeRows(roleRes);
          if (roleRows && roleRows.length > 0) {
            isSysadmin = !!(Array.isArray(roleRows[0])
              ? roleRows[0][0]
              : roleRows[0].is_sysadmin);
          }

          const srvRolesRes = await conn.query(`
            SELECT r.name,
                   CAST(ISNULL((SELECT 1 FROM sys.server_role_members rm WHERE rm.role_principal_id = r.principal_id AND rm.member_principal_id = SUSER_ID('${escapeLiteral(this._loginName)}')), 0) AS BIT) as is_member
            FROM sys.server_principals r
            WHERE r.type = 'R'
            ORDER BY r.name
          `);
          const srvRolesRows = normalizeRows(srvRolesRes);
          serverRoles = srvRolesRows.map((r: any) => ({
            name: Array.isArray(r) ? r[0] : r.name,
            isMember: !!(Array.isArray(r) ? r[1] : r.is_member),
          }));

          const dbRes = await conn.query(
            `SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name`,
          );
          const dbRows = normalizeRows(dbRes);
          databases = dbRows.map((r: any) =>
            Array.isArray(r) ? r[0] : r.name,
          );
        } else if (this._config.driver === 'postgres') {
          const res = await conn.query(`
            SELECT rolcanlogin, rolsuper
            FROM pg_roles
            WHERE rolname = '${escapeLiteral(this._loginName)}'
          `);
          const rows = normalizeRows(res);
          if (rows && rows.length > 0) {
            isDisabled = !(Array.isArray(rows[0])
              ? rows[0][0]
              : rows[0].rolcanlogin);
            isSysadmin = !!(Array.isArray(rows[0])
              ? rows[0][1]
              : rows[0].rolsuper);
          }

          const dbRes = await conn.query(
            `SELECT datname as name FROM pg_database WHERE datistemplate = false ORDER BY datname`,
          );
          const dbRows = normalizeRows(dbRes);
          databases = dbRows.map((r: any) =>
            Array.isArray(r) ? r[0] : r.name,
          );
        }
      } finally {
        if (conn) conn.release();
      }

      this._panel.webview.postMessage({
        type: 'data',
        data: {
          loginName: this._loginName,
          isDisabled,
          isSysadmin,
          serverRoles,
          databases,
        },
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(
        `Failed to load login properties: ${e.message}`,
      );
    }
  }

  private async _loadMapping(database: string) {
    try {
      const pool = await getPool(this._config);
      const conn = await pool.getConnection();
      try {
        let mappedUser = '';
        let roles: string[] = [];
        let availableRoles: string[] = [];

        if (this._config.driver === 'mssql') {
          await conn.query(
            `USE ${escapeIdentifier(this._config.driver, database)}`,
          );

          const userRes = await conn.query(`
            SELECT name
            FROM sys.database_principals
            WHERE type IN ('S', 'U', 'G') AND suser_sname(sid) = '${escapeLiteral(this._loginName)}'
          `);
          const userRows = normalizeRows(userRes);

          if (userRows && userRows.length > 0) {
            mappedUser = Array.isArray(userRows[0])
              ? userRows[0][0]
              : userRows[0].name;

            const roleRes = await conn.query(`
              SELECT r.name
              FROM sys.database_role_members rm
              JOIN sys.database_principals r ON rm.role_principal_id = r.principal_id
              WHERE rm.member_principal_id = USER_ID('${escapeLiteral(mappedUser)}')
            `);
            const roleRows = normalizeRows(roleRes);
            roles = roleRows.map((r: any) =>
              Array.isArray(r) ? r[0] : r.name,
            );
          }

          const availRoleRes = await conn.query(
            `SELECT name FROM sys.database_principals WHERE type = 'R' ORDER BY name`,
          );
          const availRoleRows = normalizeRows(availRoleRes);
          availableRoles = availRoleRows.map((r: any) =>
            Array.isArray(r) ? r[0] : r.name,
          );
        } else if (this._config.driver === 'postgres') {
          const res = await conn.query(`
            SELECT has_database_privilege('${escapeLiteral(this._loginName)}', '${escapeLiteral(database)}', 'CONNECT') as has_connect
          `);
          const rows = normalizeRows(res);
          if (rows && rows.length > 0) {
            const hasConnect = Array.isArray(rows[0])
              ? rows[0][0]
              : rows[0].has_connect;
            if (hasConnect) {
              mappedUser = this._loginName; // In Postgres, the role name is the user name
              roles = ['CONNECT'];
            }
          }

          availableRoles = ['CONNECT', 'CREATE', 'TEMPORARY'];
        }

        this._panel.webview.postMessage({
          type: 'mapping_data',
          database,
          mappedUser,
          roles,
          availableRoles,
        });
      } finally {
        if (conn) conn.release();
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(
        `Failed to load mapping for ${database}: ${e.message}`,
      );
    }
  }

  private async _saveData(data: {
    password?: string;
    isDisabled: boolean;
    isSysadmin: boolean;
    serverRoles?: string[];
    mapping?: { database: string; mappedUser: string; roles: string[] };
  }) {
    try {
      const pool = await getPool(this._config);
      const conn = await pool.getConnection();

      try {
        if (this._config.driver === 'mssql') {
          if (data.password) {
            await conn.query(
              `ALTER LOGIN ${escapeIdentifier(this._config.driver, this._loginName)} WITH PASSWORD = '${escapeLiteral(data.password)}'`,
            );
          }
          if (data.isDisabled) {
            await conn.query(
              `ALTER LOGIN ${escapeIdentifier(this._config.driver, this._loginName)} DISABLE`,
            );
          } else {
            await conn.query(
              `ALTER LOGIN ${escapeIdentifier(this._config.driver, this._loginName)} ENABLE`,
            );
          }
          if (data.isSysadmin !== undefined) {
            if (data.isSysadmin) {
              await conn.query(
                `ALTER SERVER ROLE sysadmin ADD MEMBER ${escapeIdentifier(this._config.driver, this._loginName)}`,
              );
            } else {
              try {
                await conn.query(
                  `ALTER SERVER ROLE sysadmin DROP MEMBER ${escapeIdentifier(this._config.driver, this._loginName)}`,
                );
              } catch (e) {}
            }
          }

          if (data.serverRoles) {
            for (const role of data.serverRoles) {
              try {
                await conn.query(
                  `ALTER SERVER ROLE ${escapeIdentifier(this._config.driver, role)} ADD MEMBER ${escapeIdentifier(this._config.driver, this._loginName)}`,
                );
              } catch (e) {}
            }
          }

          if (data.mapping) {
            await conn.query(
              `USE ${escapeIdentifier(this._config.driver, data.mapping.database)}`,
            );
            if (data.mapping.mappedUser) {
              const uRes = await conn.query(
                `SELECT 1 FROM sys.database_principals WHERE name = '${escapeLiteral(data.mapping.mappedUser)}'`,
              );
              const uRows = normalizeRows(uRes);
              if (!uRows || uRows.length === 0) {
                await conn.query(
                  `CREATE USER ${escapeIdentifier(this._config.driver, data.mapping.mappedUser)} FOR LOGIN ${escapeIdentifier(this._config.driver, this._loginName)}`,
                );
              }

              for (const role of data.mapping.roles) {
                try {
                  await conn.query(
                    `ALTER ROLE ${escapeIdentifier(this._config.driver, role)} ADD MEMBER ${escapeIdentifier(this._config.driver, data.mapping.mappedUser)}`,
                  );
                } catch (e) {}
              }
            }
          }
        } else if (this._config.driver === 'postgres') {
          let alters = [];
          if (data.password)
            alters.push(`PASSWORD '${escapeLiteral(data.password)}'`);
          if (data.isDisabled) alters.push('NOLOGIN');
          else alters.push('LOGIN');
          if (data.isSysadmin) alters.push('SUPERUSER');
          else alters.push('NOSUPERUSER');

          if (alters.length > 0) {
            await conn.query(
              `ALTER ROLE ${escapeIdentifier(this._config.driver, this._loginName)} ${alters.join(' ')}`,
            );
          }
        }

        vscode.window.showInformationMessage(
          `Login ${this._loginName} updated successfully.`,
        );
        this._panel.dispose();
      } finally {
        if (conn) conn.release();
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to update login: ${e.message}`);
    }
  }

  private _update() {
    const webview = this._panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'dist',
        'webview',
        'security-bundle.js',
      ),
    );

    const nonce = getNonce();

    webview.html = `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login Properties</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
