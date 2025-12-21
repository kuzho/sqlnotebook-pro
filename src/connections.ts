import * as vscode from 'vscode';
import * as path from 'path';
import { DriverKey } from './driver';

export class SQLNotebookConnections
  implements vscode.TreeDataProvider<ConnectionListItem | GroupItem | vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionListItem | GroupItem | undefined | void>();
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

  getTreeItem(element: ConnectionListItem | GroupItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConnectionListItem | GroupItem): Thenable<vscode.TreeItem[]> {
    if (element instanceof ConnectionListItem) {
      if (element.config.driver === 'sqlite') {
        return Promise.resolve([
          new vscode.TreeItem(`filename: ${element.config.path}`, vscode.TreeItemCollapsibleState.None),
          new vscode.TreeItem(`driver: ${element.config.driver}`, vscode.TreeItemCollapsibleState.None),
        ]);
      }
      return Promise.resolve([
        new vscode.TreeItem(`host: ${element.config.host}`, vscode.TreeItemCollapsibleState.None),
        new vscode.TreeItem(`user: ${element.config.user}`, vscode.TreeItemCollapsibleState.None),
        new vscode.TreeItem(`database: ${element.config.database}`, vscode.TreeItemCollapsibleState.None),
      ]);
    }

    const connections = vscode.workspace.getConfiguration('sqlnotebook').get<ConnData[]>('connections') || [];

    if (element instanceof GroupItem) {
      const children = connections.filter(c => (c.group || 'Sin Grupo') === element.label);
      return Promise.resolve(
        children.map(config => new ConnectionListItem(config, vscode.TreeItemCollapsibleState.Collapsed))
      );
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
      groups.forEach(groupName => items.push(new GroupItem(groupName)));
      orphans.forEach(config => items.push(new ConnectionListItem(config, vscode.TreeItemCollapsibleState.Collapsed)));

      return Promise.resolve(items);
    }
    return Promise.resolve([]);
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
      dark: path.join(mediaDir, 'dark', 'database.svg'),
      light: path.join(mediaDir, 'light', 'database.svg'),
    };
    this.description = config.driver;
    this.contextValue = 'database';
  }
}
export const mediaDir = path.join(__filename, '..', '..', 'media');