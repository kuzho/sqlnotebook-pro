import * as vscode from 'vscode';
import * as path from 'path';
import { DriverKey, getPool, PoolConfig, TableSchema } from './driver';

export class SQLNotebookConnections
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(public readonly context: vscode.ExtensionContext) {
    vscode.workspace.onDidChangeConfiguration(e => {
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
            password = await this.context.secrets.get(element.config.passwordKey);
          } catch (e) {}
        }

        const poolConfig = {
          ...element.config,
          password,
          queryTimeout: 15000
        } as PoolConfig;

        const pool = await getPool(poolConfig);
        const schema = await pool.getSchema();
        pool.end();

        const schemaGroups = new Map<string, TableSchema[]>();
        const orphans: TableSchema[] = [];

        schema.forEach(t => {
          if (t.schema) {
            if (!schemaGroups.has(t.schema)) {schemaGroups.set(t.schema, []);}
            schemaGroups.get(t.schema)!.push(t);
          } else {
            orphans.push(t);
          }
        });

        const items: vscode.TreeItem[] = [];

        const sortedSchemas = Array.from(schemaGroups.keys()).sort();
        for (const schemaName of sortedSchemas) {
          const tables = schemaGroups.get(schemaName)!.sort((a, b) => a.table.localeCompare(b.table));
          items.push(new SchemaItem(schemaName, tables, element.config));
        }

        orphans.sort((a, b) => a.table.localeCompare(b.table)).forEach(table => {
          items.push(new TableItem(table, element.config));
        });

        if (items.length === 0) {
          return [new vscode.TreeItem("No tables found", vscode.TreeItemCollapsibleState.None)];
        }
        return items;
      } catch (e: any) {
        const errorItem = new vscode.TreeItem(`Error: ${e.message}`, vscode.TreeItemCollapsibleState.None);
        errorItem.iconPath = new vscode.ThemeIcon('error');
        return [errorItem];
      }
    }

    if (element instanceof SchemaItem) {
      return element.tables.map(t => new TableItem(t, element.config));
    }

    if (element instanceof TableItem) {
      if (!element.tableSchema.columns || element.tableSchema.columns.length === 0) {
        return [new vscode.TreeItem("No columns", vscode.TreeItemCollapsibleState.None)];
      }
      return element.tableSchema.columns.map(c => {
        const type = element.tableSchema.columnTypes ? element.tableSchema.columnTypes[c] : undefined;
        const isPk = element.tableSchema.primaryKeys ? element.tableSchema.primaryKeys.includes(c) : false;
        return new ColumnItem(c, type, isPk);
      });
    }

    const connections = vscode.workspace.getConfiguration('sqlnotebook').get<ConnData[]>('connections') || [];

    if (element instanceof GroupItem) {
      const children = connections.filter(c => (c.group || 'No Group') === element.label);
      return children.map(config => new ConnectionListItem(config, vscode.TreeItemCollapsibleState.Collapsed));
    }

    if (!element) {
      const groups = new Set<string>();
      const orphans: ConnData[] = [];

      connections.forEach(conn => {
        if (conn.group && conn.group.trim() !== '') {
          groups.add(conn.group);
        } else {
          orphans.push(conn);
        }
      });

      const items: vscode.TreeItem[] = [];
      Array.from(groups).sort().forEach(groupName => items.push(new GroupItem(groupName)));
      orphans.sort((a, b) => a.name.localeCompare(b.name)).forEach(config => items.push(new ConnectionListItem(config, vscode.TreeItemCollapsibleState.Collapsed)));

      return items;
    }
    return [];
  }
}

export type ConnData = | ({ driver: Exclude<DriverKey, 'sqlite'>; name: string; group?: string; host: string; port: number; user: string; passwordKey: string; database: string; } & { [key: string]: any; }) | { driver: 'sqlite'; name: string; group?: string; path: string; };

export class GroupItem extends vscode.TreeItem {
  constructor(public readonly label: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class ConnectionListItem extends vscode.TreeItem {
  constructor(public readonly config: ConnData, public readonly collapsibleState: vscode.TreeItemCollapsibleState) {
    super(config.name, collapsibleState);
    this.iconPath = {
      dark: vscode.Uri.file(path.join(mediaDir, 'dark', 'database.svg')),
      light: vscode.Uri.file(path.join(mediaDir, 'light', 'database.svg')),
    };
    this.description = config.driver;
    this.contextValue = 'database';
  }
}

export class SchemaItem extends vscode.TreeItem {
  constructor(public readonly schemaName: string, public readonly tables: TableSchema[], public readonly config: ConnData) {
    super(schemaName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'schema';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
  }
}

export class TableItem extends vscode.TreeItem {
  constructor(public readonly tableSchema: TableSchema, public readonly config: ConnData) {
    super(tableSchema.table, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'table';
    this.iconPath = new vscode.ThemeIcon('table');
    this.description = tableSchema.schema ? undefined : ''; 
  }
}

export class ColumnItem extends vscode.TreeItem {
  constructor(public readonly columnName: string, public readonly dataType?: string, public readonly isPrimaryKey: boolean = false) {
    super(columnName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'column';
    this.iconPath = new vscode.ThemeIcon(isPrimaryKey ? 'key' : 'symbol-field');
    if (dataType) {
      this.tooltip = `${columnName} (${dataType})`;
      this.description = dataType;
    }
  }
}
export const mediaDir = path.join(__filename, '..', '..', 'media');