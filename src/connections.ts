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
export class PrimaryKeysGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Primary Keys', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'primary-keys-group';
    this.iconPath = new vscode.ThemeIcon('key');
    const pkCount = tableSchema.primaryKeys?.length || 0;
    this.description = `${pkCount}`;
  }
}
export class ForeignKeysGroupItem extends vscode.TreeItem {
  constructor(
    public readonly tableSchema: TableSchema,
    public readonly config: ConnData,
  ) {
    super('Foreign Keys', vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'foreign-keys-group';
    this.iconPath = new vscode.ThemeIcon('link');
    const fkCount = tableSchema.foreignKeys?.length || 0;
    this.description = `${fkCount}`;
  }
}
export class KeyItem extends vscode.TreeItem {
  constructor(
    public readonly columnName: string,
    keyType: string,
  ) {
    super(columnName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'key';
    this.iconPath = new vscode.ThemeIcon('key');
    this.description = keyType;
    this.tooltip = `Primary Key: ${columnName}`;
  }
}
export class ForeignKeyItem extends vscode.TreeItem {
  constructor(public readonly fk: import('./driver').ForeignKey) {
    super(
      `${fk.column} → ${fk.referencedTable}.${fk.referencedColumn}`,
      vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = 'foreign-key';
    this.iconPath = new vscode.ThemeIcon('link');
    this.tooltip =
      `Foreign Key: ${fk.column} references ${fk.referencedTable}(${fk.referencedColumn})` +
      (fk.referencedSchema ? ` in schema ${fk.referencedSchema}` : '');
    this.description = fk.referencedTable;
  }
}
import * as vscode from 'vscode';
import * as path from 'path';
import { DriverKey, getPool, PoolConfig, TableSchema } from './driver';
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
        let password = (element.config as any).password;
        if (!password && element.config.driver !== 'sqlite') {
          try {
            password = await this.context.secrets.get(
              element.config.passwordKey,
            );
          } catch (e) {}
        }
        const poolConfig = {
          ...element.config,
          password,
          queryTimeout: 15000,
        } as PoolConfig;
        const pool = await getPool(poolConfig);
        let schema: TableSchema[] = [];
        try {
          schema = await pool.getSchema();
        } finally {
          try {
            pool.end();
          } catch (e) {}
        }
        const schemaGroups = new Map<string, TableSchema[]>();
        const orphans: TableSchema[] = [];
        schema.forEach((obj) => {
          if (obj.schema) {
            if (!schemaGroups.has(obj.schema)) {
              schemaGroups.set(obj.schema, []);
            }
            schemaGroups.get(obj.schema)!.push(obj);
          } else {
            orphans.push(obj);
          }
        });

        const isSingleSchemaEngine =
          element.config.driver === 'mysql' ||
          element.config.driver === 'sqlite' ||
          (schemaGroups.size === 1 &&
            (element.config as any).database &&
            schemaGroups.has((element.config as any).database));

        if (isSingleSchemaEngine && schemaGroups.size === 1) {
          const singleSchemaObjects = Array.from(schemaGroups.values())[0];
          orphans.push(...singleSchemaObjects);
          schemaGroups.clear();
        }

        const items: vscode.TreeItem[] = [];
        const sortedSchemas = Array.from(schemaGroups.keys()).sort();
        for (const schemaName of sortedSchemas) {
          const objects = schemaGroups.get(schemaName)!;
          items.push(new SchemaItem(schemaName, objects, element.config));
        }
        if (orphans.length > 0) {
          const tables = orphans.filter((o) => o.type === 'table');
          const views = orphans.filter((o) => o.type === 'view');
          const procs = orphans.filter((o) => o.type === 'procedure');
          const funcs = orphans.filter((o) => o.type === 'function');
          if (tables.length) {
            items.push(
              new ObjectGroupItem('Tables', tables, element.config, 'table'),
            );
          }
          if (views.length) {
            items.push(
              new ObjectGroupItem('Views', views, element.config, 'view'),
            );
          }
          if (procs.length) {
            items.push(
              new ObjectGroupItem(
                'Procedures',
                procs,
                element.config,
                'procedure',
              ),
            );
          }
          if (funcs.length) {
            items.push(
              new ObjectGroupItem(
                'Functions',
                funcs,
                element.config,
                'function',
              ),
            );
          }
        }
        if (items.length === 0) {
          return [
            new vscode.TreeItem(
              'No objects found',
              vscode.TreeItemCollapsibleState.None,
            ),
          ];
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
    if (element instanceof SchemaItem) {
      const tables = element.objects.filter((o) => o.type === 'table');
      const views = element.objects.filter((o) => o.type === 'view');
      const procs = element.objects.filter((o) => o.type === 'procedure');
      const funcs = element.objects.filter((o) => o.type === 'function');
      const items: vscode.TreeItem[] = [];
      if (tables.length) {
        items.push(
          new ObjectGroupItem('Tables', tables, element.config, 'table'),
        );
      }
      if (views.length) {
        items.push(new ObjectGroupItem('Views', views, element.config, 'view'));
      }
      if (procs.length) {
        items.push(
          new ObjectGroupItem('Procedures', procs, element.config, 'procedure'),
        );
      }
      if (funcs.length) {
        items.push(
          new ObjectGroupItem('Functions', funcs, element.config, 'function'),
        );
      }
      if (items.length === 0) {
        return [
          new vscode.TreeItem(
            'No objects in schema',
            vscode.TreeItemCollapsibleState.None,
          ),
        ];
      }
      return items;
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
      if (
        element.tableSchema.primaryKeys &&
        element.tableSchema.primaryKeys.length > 0
      ) {
        children.push(
          new PrimaryKeysGroupItem(element.tableSchema, element.config),
        );
      }
      if (
        element.tableSchema.foreignKeys &&
        element.tableSchema.foreignKeys.length > 0
      ) {
        children.push(
          new ForeignKeysGroupItem(element.tableSchema, element.config),
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
    if (element instanceof PrimaryKeysGroupItem) {
      return element.tableSchema.primaryKeys!.map(
        (pk) => new KeyItem(pk, 'Primary Key'),
      );
    }
    if (element instanceof ForeignKeysGroupItem) {
      return element.tableSchema.foreignKeys!.map(
        (fk) => new ForeignKeyItem(fk),
      );
    }
    if (element instanceof ViewItem) {
      if (
        !element.tableSchema.columns ||
        element.tableSchema.columns.length === 0
      ) {
        return [
          new vscode.TreeItem(
            'No columns',
            vscode.TreeItemCollapsibleState.None,
          ),
        ];
      }
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
      const hostDisplay = config.port ? `${config.host}:${config.port}` : config.host;
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
    if (tableCount) {parts.push(`${tableCount} tbls`);}
    if (viewCount) {parts.push(`${viewCount} views`);}
    if (procCount) {parts.push(`${procCount} procs`);}
    if (funcCount) {parts.push(`${funcCount} funcs`);}
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
    super(tableSchema.table, vscode.TreeItemCollapsibleState.Collapsed);
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
    super(tableSchema.table, vscode.TreeItemCollapsibleState.Collapsed);
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
    super(tableSchema.table, vscode.TreeItemCollapsibleState.None);
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
    super(tableSchema.table, vscode.TreeItemCollapsibleState.None);
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
    default:
      return new TableItem(obj, config);
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

