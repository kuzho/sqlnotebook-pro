export class ColumnsGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Columns', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'columns-group';
    this.iconPath = new vscode.ThemeIcon('symbol-field');
    const colCount = tableSchema.columns?.length || 0;
    this.description = `${colCount}`;
  }
}
export class KeysGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Keys', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'keys-group';
    this.iconPath = new vscode.ThemeIcon('key');
  }
}
export class ConstraintsGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Constraints', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'constraints-group';
    this.iconPath = new vscode.ThemeIcon('layout-sidebar-right');
  }
}
export class StatisticsGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Statistics', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'statistics-group';
    this.iconPath = new vscode.ThemeIcon('graph');
  }
}
export class KeyItem extends vscode.TreeItem {
  constructor(
    public readonly keyName: string,
    keyType: string,
  ) {
    super(keyName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'key';

    let icon = 'key';
    let typeName = 'Primary Key';

    if (keyType === 'PK') {
      icon = 'key';
      typeName = 'Primary Key';
    } else if (keyType === 'UQ') {
      icon = 'lock';
      typeName = 'Unique Key';
    } else if (keyType === 'F') {
      icon = 'link';
      typeName = 'Foreign Key';
    } else {
      typeName = 'Key';
    }

    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = typeName;
    this.tooltip = `${typeName}: ${keyName}`;
  }
}
export class ConstraintItem extends vscode.TreeItem {
  constructor(public readonly constraintName: string) {
    super(constraintName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'constraint';
    this.iconPath = new vscode.ThemeIcon('layout-sidebar-right');
  }
}
export class StatisticItem extends vscode.TreeItem {
  constructor(public readonly statisticName: string) {
    super(statisticName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'statistic';
    this.iconPath = new vscode.ThemeIcon('graph');
  }
}
import * as vscode from 'vscode';
import * as path from 'path';
import { DriverKey, getPool, PoolConfig, TableSchema } from './driver';

export async function resolveConfigPassword(
  context: vscode.ExtensionContext,
  config: ConnData,
): Promise<ConnData> {
  let password = (config as any).password;
  if (!password && config.driver !== 'sqlite') {
    try {
      password = await context.secrets.get(config.passwordKey);
    } catch (e) {}
  }
  return { ...config, password } as ConnData;
}

export class SQLNotebookConnections implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  constructor(public readonly context: vscode.ExtensionContext) {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sqlnotebook.connections')) {
        this.refresh();
      }
    });
  }
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element instanceof ConnectionListItem) {
      try {
        const items: vscode.TreeItem[] = [];
        items.push(
          new DatabaseRootGroupItem('Tables', [], element.config, 'tables'),
        );
        items.push(
          new DatabaseRootGroupItem('Views', [], element.config, 'views'),
        );
        items.push(
          new DatabaseRootGroupItem('Synonyms', [], element.config, 'synonyms'),
        );
        items.push(
          new DatabaseRootGroupItem(
            'Programmability',
            [],
            element.config,
            'programmability',
          ),
        );
        items.push(
          new DatabaseRootGroupItem('Security', [], element.config, 'security'),
        );
        if (element.config.driver === 'mssql') {
          items.push(
            new DatabaseRootGroupItem(
              'Server Objects',
              [],
              element.config,
              'server_objects',
            ),
          );
          items.push(
            new DatabaseRootGroupItem(
              'Linked Servers',
              [],
              element.config,
              'linked_servers',
            ),
          );
          items.push(
            new DatabaseRootGroupItem(
              'SQL Server Agent',
              [],
              element.config,
              'agent_jobs',
            ),
          );
          items.push(
            new DatabaseRootGroupItem('Logins', [], element.config, 'logins'),
          );
        }
        return items;
      } catch (e: any) {
        const errorItem = new vscode.TreeItem(
          `Error: ${e.message}`,
          vscode.TreeItemCollapsibleState.None,
        );
        errorItem.iconPath = new vscode.ThemeIcon('error');
        return [errorItem];
      }
    }

    if (element instanceof DatabaseRootGroupItem) {
      if (!(element as any).isLoaded) {
        const resolvedConfig = await resolveConfigPassword(
          this.context,
          element.config,
        );
        const pool = await getPool({
          ...resolvedConfig,
          queryTimeout: 15000,
        } as PoolConfig);
        try {
          if (element.rootType === 'security' && pool.getSecurity) {
            element.objects = await pool.getSecurity();
          } else {
            const schema = await pool.getSchema();
            if (element.rootType === 'tables')
              element.objects = schema.filter(
                (o) => o.type === 'table' || o.type === 'system_table',
              );
            else if (element.rootType === 'views')
              element.objects = schema.filter(
                (o) => o.type === 'view' || o.type === 'system_view',
              );
            else if (element.rootType === 'programmability')
              element.objects = schema.filter((o) =>
                [
                  'procedure',
                  'function',
                  'type',
                  'sequence',
                  'database_trigger',
                ].includes(o.type || ''),
              );
            else if (element.rootType === 'security')
              element.objects = schema.filter(
                (o) => o.type === 'user' || o.type === 'role',
              );
            else if (element.rootType === 'logins')
              element.objects = schema.filter((o) => o.type === 'login');
            else if (element.rootType === 'synonyms')
              element.objects = schema.filter((o) => o.type === 'synonym');
            else if (
              element.rootType === 'server_objects' &&
              pool.getServerObjects
            )
              element.objects = await pool.getServerObjects();
            else if (
              element.rootType === 'linked_servers' &&
              pool.getLinkedServers
            )
              element.objects = await pool.getLinkedServers();
            else if (element.rootType === 'agent_jobs' && pool.getAgentJobs)
              element.objects = await pool.getAgentJobs();
          }
          (element as any).isLoaded = true;
        } finally {
          try {
            pool.end();
          } catch (e) {}
        }
      }

      if (element.rootType === 'tables') {
        const userTables = element.objects.filter((o) => o.type === 'table');
        const sysTables = element.objects.filter(
          (o) => o.type === 'system_table',
        );
        const items: vscode.TreeItem[] = [];
        if (sysTables.length)
          items.push(
            new DatabaseRootGroupItem(
              'System Tables',
              sysTables,
              element.config,
              'system_tables',
            ),
          );
        items.push(
          ...userTables
            .sort((a, b) =>
              (a.schema ? a.schema + '.' : '') + a.table >
              (b.schema ? b.schema + '.' : '') + b.table
                ? 1
                : -1,
            )
            .map((obj) => createObjectTreeItem(obj, element.config)),
        );
        return items;
      }
      if (element.rootType === 'views') {
        const userViews = element.objects.filter((o) => o.type === 'view');
        const sysViews = element.objects.filter(
          (o) => o.type === 'system_view',
        );
        const items: vscode.TreeItem[] = [];
        if (sysViews.length)
          items.push(
            new DatabaseRootGroupItem(
              'System Views',
              sysViews,
              element.config,
              'system_views',
            ),
          );
        items.push(
          ...userViews
            .sort((a, b) =>
              (a.schema ? a.schema + '.' : '') + a.table >
              (b.schema ? b.schema + '.' : '') + b.table
                ? 1
                : -1,
            )
            .map((obj) => createObjectTreeItem(obj, element.config)),
        );
        return items;
      }
      if (element.rootType === 'programmability') {
        const procs = element.objects.filter((o) => o.type === 'procedure');
        const funcs = element.objects.filter((o) => o.type === 'function');
        const types = element.objects.filter((o) => o.type === 'type');
        const seqs = element.objects.filter((o) => o.type === 'sequence');
        const db_trigs = element.objects.filter(
          (o) => o.type === 'database_trigger',
        );
        const items: vscode.TreeItem[] = [];
        if (procs.length)
          items.push(
            new DatabaseRootGroupItem(
              'Stored Procedures',
              procs,
              element.config,
              'procedures',
            ),
          );
        if (funcs.length)
          items.push(
            new DatabaseRootGroupItem(
              'Functions',
              funcs,
              element.config,
              'functions',
            ),
          );
        if (types.length)
          items.push(
            new DatabaseRootGroupItem('Types', types, element.config, 'types'),
          );
        if (seqs.length)
          items.push(
            new DatabaseRootGroupItem(
              'Sequences',
              seqs,
              element.config,
              'sequences',
            ),
          );
        if (db_trigs.length)
          items.push(
            new DatabaseRootGroupItem(
              'Database Triggers',
              db_trigs,
              element.config,
              'database_triggers',
            ),
          );
        return items;
      }
      if (element.rootType === 'security') {
        const schemas = element.objects.filter((o) => o.type === 'schema');
        const users = element.objects.filter((o) => o.type === 'user');
        const roles = element.objects.filter((o) => o.type === 'role');
        const items: vscode.TreeItem[] = [];
        if (schemas.length)
          items.push(
            new DatabaseRootGroupItem(
              `Schemas`,
              schemas,
              element.config,
              'schemas',
            ),
          );
        if (users.length)
          items.push(
            new DatabaseRootGroupItem(`Users`, users, element.config, 'users'),
          );
        if (roles.length)
          items.push(
            new DatabaseRootGroupItem(`Roles`, roles, element.config, 'roles'),
          );
        return items;
      }
      if (element.rootType === 'logins') {
        return element.objects
          .sort((a, b) => (a.table > b.table ? 1 : -1))
          .map((obj) => createObjectTreeItem(obj, element.config));
      }
      if (element.rootType === 'server_objects') {
        const endpoints = element.objects.filter((o) => o.type === 'endpoint');
        const triggers = element.objects.filter(
          (o) => o.type === 'server_trigger',
        );
        const items: vscode.TreeItem[] = [];
        if (endpoints.length)
          items.push(
            new DatabaseRootGroupItem(
              'Endpoints',
              endpoints,
              element.config,
              'endpoints',
            ),
          );
        if (triggers.length)
          items.push(
            new DatabaseRootGroupItem(
              'Triggers',
              triggers,
              element.config,
              'server_triggers',
            ),
          );
        return items;
      }
      if (
        [
          'procedures',
          'functions',
          'users',
          'roles',
          'schemas',
          'system_tables',
          'system_views',
          'types',
          'sequences',
          'database_triggers',
          'synonyms',
          'logins',
          'linked_servers',
          'agent_jobs',
          'endpoints',
          'server_triggers',
        ].includes(element.rootType)
      ) {
        return element.objects
          .sort((a, b) =>
            (a.schema ? a.schema + '.' : '') + a.table >
            (b.schema ? b.schema + '.' : '') + b.table
              ? 1
              : -1,
          )
          .map((obj) => createObjectTreeItem(obj, element.config));
      }
    }
    if (element instanceof ObjectGroupItem) {
      return element.objects.map((obj) =>
        createObjectTreeItem(obj, element.config),
      );
    }
    if (element instanceof TableItem) {
      const children: vscode.TreeItem[] = [];
      if (
        element.tableSchema.columns &&
        element.tableSchema.columns.length > 0
      ) {
        children.push(
          new ColumnsGroupItem(element.tableSchema, element.config),
        );
      }
      if (!(element as any).isLoadedIndexes) {
        const resolvedConfig = await resolveConfigPassword(
          this.context,
          element.config,
        );
        const pool = await getPool({
          ...resolvedConfig,
          queryTimeout: 15000,
        } as PoolConfig);
        try {
          if (pool.getKeys) {
            element.tableSchema.keys = await pool.getKeys(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          if (pool.getConstraints) {
            element.tableSchema.constraints = await pool.getConstraints(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          if (pool.getTableTriggers) {
            element.tableSchema.triggers = await pool.getTableTriggers(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          if (pool.getIndexes) {
            element.tableSchema.indexes = await pool.getIndexes(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          if (pool.getStatistics) {
            element.tableSchema.statistics = await pool.getStatistics(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          (element as any).isLoadedIndexes = true;
        } finally {
          try {
            pool.end();
          } catch (e) {}
        }
      }

      if (element.tableSchema.keys && element.tableSchema.keys.length > 0) {
        children.push(new KeysGroupItem(element.tableSchema, element.config));
      }
      if (
        element.tableSchema.constraints &&
        element.tableSchema.constraints.length > 0
      ) {
        children.push(
          new ConstraintsGroupItem(element.tableSchema, element.config),
        );
      }

      if (
        element.tableSchema.indexes &&
        element.tableSchema.indexes.length > 0
      ) {
        children.push(
          new IndexesGroupItem(element.tableSchema, element.config),
        );
      }
      if (
        element.tableSchema.triggers &&
        element.tableSchema.triggers.length > 0
      ) {
        children.push(
          new TriggersGroupItem(element.tableSchema, element.config),
        );
      }

      return children.length
        ? children
        : [
            new vscode.TreeItem(
              'No details',
              vscode.TreeItemCollapsibleState.None,
            ),
          ];
    }
    if (element instanceof ColumnsGroupItem) {
      return element.tableSchema.columns.map((c) => {
        const type = element.tableSchema.columnTypes
          ? element.tableSchema.columnTypes[c]
          : undefined;
        const isPk = element.tableSchema.primaryKeys
          ? element.tableSchema.primaryKeys.includes(c)
          : false;
        const isFk = element.tableSchema.foreignKeys
          ? element.tableSchema.foreignKeys.some((f) => f.column === c)
          : false;
        return new ColumnItem(c, type, isPk, isFk);
      });
    }

    if (element instanceof IndexesGroupItem) {
      return element.tableSchema.indexes!.map((i) => new IndexItem(i));
    }
    if (element instanceof TriggersGroupItem) {
      return element.tableSchema.triggers!.map((t) => new TriggerItem(t));
    }
    if (element instanceof KeysGroupItem) {
      return element.tableSchema.keys!.map((k) => new KeyItem(k.name, k.type));
    }
    if (element instanceof ConstraintsGroupItem) {
      return element.tableSchema.constraints!.map((c) => new ConstraintItem(c));
    }
    if (element instanceof StatisticsGroupItem) {
      return element.tableSchema.statistics!.map((s) => new StatisticItem(s));
    }
    if (element instanceof ViewItem) {
      const children: vscode.TreeItem[] = [];
      if (
        element.tableSchema.columns &&
        element.tableSchema.columns.length > 0
      ) {
        children.push(
          new ColumnsGroupItem(element.tableSchema, element.config),
        );
      }

      if (!(element as any).isLoadedIndexes) {
        const resolvedConfig = await resolveConfigPassword(
          this.context,
          element.config,
        );
        const pool = await getPool({
          ...resolvedConfig,
          queryTimeout: 15000,
        } as PoolConfig);
        try {
          if (pool.getIndexes) {
            element.tableSchema.indexes = await pool.getIndexes(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          if (pool.getTableTriggers) {
            element.tableSchema.triggers = await pool.getTableTriggers(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          if (pool.getStatistics) {
            element.tableSchema.statistics = await pool.getStatistics(
              element.tableSchema.table,
              element.tableSchema.schema,
            );
          }
          (element as any).isLoadedIndexes = true;
        } finally {
          try {
            pool.end();
          } catch (e) {}
        }
      }

      if (
        element.tableSchema.indexes &&
        element.tableSchema.indexes.length > 0
      ) {
        children.push(
          new IndexesGroupItem(element.tableSchema, element.config),
        );
      }
      if (
        element.tableSchema.triggers &&
        element.tableSchema.triggers.length > 0
      ) {
        children.push(
          new TriggersGroupItem(element.tableSchema, element.config),
        );
      }
      if (
        element.tableSchema.statistics &&
        element.tableSchema.statistics.length > 0
      ) {
        children.push(
          new StatisticsGroupItem(element.tableSchema, element.config),
        );
      }

      return children.length
        ? children
        : [
            new vscode.TreeItem(
              'No details',
              vscode.TreeItemCollapsibleState.None,
            ),
          ];
    }
    let connections =
      vscode.workspace
        .getConfiguration('sqlnotebook')
        .get<ConnData[]>('connections') || [];
    if (element instanceof GroupItem) {
      const children = connections.filter(
        (c) => (c.group || 'No Group') === element.label,
      );
      return children.map(
        (config) =>
          new ConnectionListItem(
            config,
            vscode.TreeItemCollapsibleState.Collapsed,
          ),
      );
    }
    if (!element) {
      const groups = new Set<string>();
      const orphans: ConnData[] = [];
      connections.forEach((conn) => {
        if (conn.group && conn.group.trim() !== '') {
          groups.add(conn.group);
        } else {
          orphans.push(conn);
        }
      });
      const items: vscode.TreeItem[] = [];
      Array.from(groups)
        .sort()
        .forEach((groupName) => items.push(new GroupItem(groupName)));
      orphans
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((config) =>
          items.push(
            new ConnectionListItem(
              config,
              vscode.TreeItemCollapsibleState.Collapsed,
            ),
          ),
        );
      return items;
    }
    return [];
  }
}
export type ConnData =
  | ({
      driver: Exclude<DriverKey, 'sqlite'>;
      name: string;
      group?: string;
      host: string;
      port: number;
      user: string;
      passwordKey: string;
      database: string;
      enableSsh?: boolean;
      sshHost?: string;
      sshPort?: number;
      sshUser?: string;
      sshKey?: string;
      sshPasswordKey?: string;
    } & { [key: string]: any })
  | { driver: 'sqlite'; name: string; group?: string; path: string };

export class GroupItem extends vscode.TreeItem {
  constructor(public readonly label: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}
export class ConnectionListItem extends vscode.TreeItem {
  constructor(
    public readonly config: ConnData,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(config.name, collapsibleState);
    this.iconPath = {
      dark: vscode.Uri.file(path.join(mediaDir, 'dark', 'database.svg')),
      light: vscode.Uri.file(path.join(mediaDir, 'light', 'database.svg')),
    };
    if (config.driver === 'sqlite') {
      this.description = `sqlite (${path.basename(config.path)})`;
      this.tooltip = `Driver: sqlite\nPath: ${config.path}`;
    } else {
      const hostDisplay = config.port
        ? `${config.host}:${config.port}`
        : config.host;
      this.description = `${config.driver} (${config.database})`;
      this.tooltip = `Driver: ${config.driver}\nHost: ${hostDisplay}\nDatabase: ${config.database}\nUser: ${config.user || 'N/A'}`;
    }
    this.contextValue = 'database';
  }
}
export class SchemaItem extends vscode.TreeItem {
  constructor(
    public readonly schemaName: string,
    public readonly objects: TableSchema[],
    public readonly config: ConnData,
  ) {
    super(schemaName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'schema';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    const tableCount = objects.filter((o) => o.type === 'table').length;
    const viewCount = objects.filter((o) => o.type === 'view').length;
    const procCount = objects.filter((o) => o.type === 'procedure').length;
    const funcCount = objects.filter((o) => o.type === 'function').length;
    const parts: string[] = [];
    if (tableCount) {
      parts.push(`${tableCount} tbls`);
    }
    if (viewCount) {
      parts.push(`${viewCount} views`);
    }
    if (procCount) {
      parts.push(`${procCount} procs`);
    }
    if (funcCount) {
      parts.push(`${funcCount} funcs`);
    }
    this.description = parts.join(', ') || `${objects.length} items`;
    this.tooltip = `Schema: ${schemaName} (${objects.length} total objects)`;
  }
}
export class ObjectGroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly objects: TableSchema[],
    public readonly config: ConnData,
    public readonly type: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `object-group-${type}`;
    this.iconPath = new vscode.ThemeIcon(
      type === 'table'
        ? 'table'
        : type === 'view'
          ? 'eye'
          : type === 'procedure'
            ? 'symbol-method'
            : 'symbol-function',
    );
    this.description = `${objects.length}`;
    this.tooltip = `${label}: ${objects.length} items`;
  }
}
export class TableItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(
      tableSchema.schema &&
        tableSchema.schema !== 'dbo' &&
        tableSchema.schema !== 'public'
        ? `${tableSchema.schema}.${tableSchema.table}`
        : tableSchema.table,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.contextValue = 'table';
    this.iconPath = new vscode.ThemeIcon('table');
    const colCount = tableSchema.columns?.length || 0;
    this.description = `${colCount} cols`;
    const pkStr = tableSchema.primaryKeys?.length
      ? `\nPrimary Keys: ${tableSchema.primaryKeys.join(', ')}`
      : '';
    const fkStr = tableSchema.foreignKeys?.length
      ? `\nForeign Keys: ${tableSchema.foreignKeys.length}`
      : '';
    this.tooltip = `Table: ${tableSchema.schema ? `${tableSchema.schema}.` : ''}${tableSchema.table}\nColumns: ${colCount}${pkStr}${fkStr}`;
  }
}
export class ViewItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(
      tableSchema.schema &&
        tableSchema.schema !== 'dbo' &&
        tableSchema.schema !== 'public'
        ? `${tableSchema.schema}.${tableSchema.table}`
        : tableSchema.table,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.contextValue = 'view';
    this.iconPath = new vscode.ThemeIcon('eye');
    const colCount = tableSchema.columns?.length || 0;
    this.description = `${colCount} cols`;
    this.tooltip = `View: ${tableSchema.schema ? `${tableSchema.schema}.` : ''}${tableSchema.table}\nColumns: ${colCount}`;
  }
}
export class ProcedureItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(
      tableSchema.schema &&
        tableSchema.schema !== 'dbo' &&
        tableSchema.schema !== 'public'
        ? `${tableSchema.schema}.${tableSchema.table}`
        : tableSchema.table,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'procedure';
    this.iconPath = new vscode.ThemeIcon('symbol-method');
    this.tooltip = `Procedure: ${tableSchema.schema ? `${tableSchema.schema}.` : ''}${tableSchema.table}`;
  }
}
export class FunctionItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(
      tableSchema.schema &&
        tableSchema.schema !== 'dbo' &&
        tableSchema.schema !== 'public'
        ? `${tableSchema.schema}.${tableSchema.table}`
        : tableSchema.table,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'function';
    this.iconPath = new vscode.ThemeIcon('symbol-function');
    this.tooltip = `Function: ${tableSchema.schema ? `${tableSchema.schema}.` : ''}${tableSchema.table}`;
  }
}
function createObjectTreeItem(
  obj: TableSchema,
  config: ConnData,
): vscode.TreeItem {
  switch (obj.type) {
    case 'table':
      return new TableItem(obj, config);
    case 'view':
      return new ViewItem(obj, config);
    case 'procedure':
      return new ProcedureItem(obj, config);
    case 'function':
      return new FunctionItem(obj, config);
    case 'user':
      return new UserItem(obj.table);
    case 'role':
      return new RoleItem(obj.table);
    case 'login':
      return new LoginItem(obj.table, config);
    case 'synonym':
      return new SynonymItem(obj, config);
    case 'sequence':
      return new SequenceItem(obj, config);
    case 'type':
      return new TypeItem(obj, config);
    case 'database_trigger':
      return new DatabaseTriggerItem(obj, config);
    case 'system_table':
      return new TableItem(obj, config);
    case 'system_view':
      return new ViewItem(obj, config);

    case 'schema':
      return new SecuritySchemaItem(obj.table);
    case 'agent_job':
      return new AgentJobItem(obj.table);
    case 'linked_server':
      return new LinkedServerItem(obj.table);
    case 'server_trigger':
      return new ServerTriggerItem(obj.table);
    case 'endpoint':
      return new EndpointItem(obj.table);
    default:
      return new TableItem(obj, config);
  }
}

export class SecuritySchemaItem extends vscode.TreeItem {
  constructor(public readonly name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'schema';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
  }
}
export class AgentJobItem extends vscode.TreeItem {
  constructor(public readonly name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'agent_job';
    this.iconPath = new vscode.ThemeIcon('play-circle');
  }
}
export class LinkedServerItem extends vscode.TreeItem {
  constructor(public readonly name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'linked_server';
    this.iconPath = new vscode.ThemeIcon('server');
  }
}
export class ServerTriggerItem extends vscode.TreeItem {
  constructor(public readonly name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'server_trigger';
    this.iconPath = new vscode.ThemeIcon('zap');
  }
}
export class EndpointItem extends vscode.TreeItem {
  constructor(public readonly name: string) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'endpoint';
    this.iconPath = new vscode.ThemeIcon('plug');
  }
}
export class ColumnItem extends vscode.TreeItem {
  constructor(
    public readonly columnName: string,
    public readonly dataType?: string,
    public readonly isPrimaryKey: boolean = false,
    public readonly isForeignKey: boolean = false,
  ) {
    super(columnName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'column';
    this.iconPath = new vscode.ThemeIcon(
      isPrimaryKey ? 'key' : isForeignKey ? 'link' : 'symbol-field',
    );
    this.description = dataType || '';
    const keyInfo = isPrimaryKey
      ? ' [🔑 Primary Key]'
      : isForeignKey
        ? ' [🔗 Foreign Key]'
        : '';
    this.tooltip = `Column: ${columnName}${dataType ? ` (${dataType})` : ''}${keyInfo}`;
  }
}
export const mediaDir = path.join(__filename, '..', '..', 'media');

export class DatabaseRootGroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public objects: TableSchema[],
    public readonly config: ConnData,
    public readonly rootType: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `root-group-${rootType}`;

    let icon = 'folder';
    if (rootType === 'tables') icon = 'table';
    if (rootType === 'views') icon = 'eye';
    if (rootType === 'programmability') icon = 'symbol-file';
    if (rootType === 'security') icon = 'shield';
    if (rootType === 'procedures') icon = 'symbol-method';
    if (rootType === 'system_tables' || rootType === 'system_views')
      icon = 'server-environment';
    if (rootType === 'types') icon = 'symbol-class';
    if (rootType === 'sequences') icon = 'list-ordered';
    if (rootType === 'database_triggers') icon = 'zap';
    if (rootType === 'synonyms') icon = 'symbol-reference';
    if (rootType === 'functions') icon = 'symbol-function';
    if (rootType === 'users') icon = 'person';
    if (rootType === 'roles') icon = 'organization';
    if (rootType === 'logins') icon = 'account';

    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class IndexesGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Indexes', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'indexes-group';
    this.iconPath = new vscode.ThemeIcon('list-tree');
    this.description = `${tableSchema.indexes?.length || 0}`;
  }
}

export class TriggersGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Triggers', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'triggers-group';
    this.iconPath = new vscode.ThemeIcon('zap');
    this.description = `${tableSchema.triggers?.length || 0}`;
  }
}

export class IndexItem extends vscode.TreeItem {
  constructor(public readonly indexName: string) {
    super(indexName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'index';
    this.iconPath = new vscode.ThemeIcon('list-flat');
  }
}

export class TriggerItem extends vscode.TreeItem {
  constructor(public readonly triggerName: string) {
    super(triggerName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'trigger';
    this.iconPath = new vscode.ThemeIcon('zap');
  }
}

export class UserItem extends vscode.TreeItem {
  constructor(public readonly userName: string) {
    super(userName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'user';
    this.iconPath = new vscode.ThemeIcon('person');
  }
}

export class RoleItem extends vscode.TreeItem {
  constructor(public readonly roleName: string) {
    super(roleName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'role';
    this.iconPath = new vscode.ThemeIcon('organization');
  }
}

export class SynonymItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(
      tableSchema.schema &&
        tableSchema.schema !== 'dbo' &&
        tableSchema.schema !== 'public'
        ? `${tableSchema.schema}.${tableSchema.table}`
        : tableSchema.table,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'synonym';
    this.iconPath = new vscode.ThemeIcon('symbol-reference');
  }
}
export class SequenceItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(
      tableSchema.schema &&
        tableSchema.schema !== 'dbo' &&
        tableSchema.schema !== 'public'
        ? `${tableSchema.schema}.${tableSchema.table}`
        : tableSchema.table,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'sequence';
    this.iconPath = new vscode.ThemeIcon('list-ordered');
  }
}
export class TypeItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(
      tableSchema.schema &&
        tableSchema.schema !== 'dbo' &&
        tableSchema.schema !== 'public'
        ? `${tableSchema.schema}.${tableSchema.table}`
        : tableSchema.table,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'type';
    this.iconPath = new vscode.ThemeIcon('symbol-class');
  }
}
export class DatabaseTriggerItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super(tableSchema.table, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'database_trigger';
    this.iconPath = new vscode.ThemeIcon('zap');
  }
}

export class LoginItem extends vscode.TreeItem {
  constructor(
    public readonly loginName: string,
    public readonly config: ConnData,
  ) {
    super(loginName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'login';
    this.iconPath = new vscode.ThemeIcon('account');
    this.tooltip = `Server Login: ${loginName}`;
  }
}
