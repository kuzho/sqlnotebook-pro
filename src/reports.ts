import * as vscode from 'vscode';
export interface ReportDataset {
  name: string;
  connectionName: string;
  query: string;
  width: 'quarter' | 'half' | 'three-quarter' | 'full';
  type: 'table' | 'bar' | 'line' | 'pie' | 'card';
}
export interface ReportParameter {
  name: string;
  label: string;
  defaultValue: string;
  type?: 'text' | 'date' | 'select';
  options?: string;
}
export interface ReportData {
  name: string;
  group?: string;
  datasets: ReportDataset[];
  refreshInterval?: number;
}

export class SQLNotebookReports implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  constructor() {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('sqlnotebook.reports')) {
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
  getChildren(
    element?: vscode.TreeItem,
  ): vscode.ProviderResult<vscode.TreeItem[]> {
    const reports =
      vscode.workspace
        .getConfiguration('sqlnotebook')
        .get<ReportData[]>('reports') || [];
    if (element instanceof GroupItem) {
      return reports
        .filter((r) => r.group === element.label)
        .map((r) => new ReportItem(r));
    }
    if (!element) {
      const groups = new Set<string>();
      const orphans: ReportData[] = [];
      reports.forEach((r) => {
        if (r.group && r.group.trim() !== '') {
          groups.add(r.group);
        } else {
          orphans.push(r);
        }
      });
      const items: vscode.TreeItem[] = [];
      Array.from(groups)
        .sort()
        .forEach((g) => items.push(new GroupItem(g)));
      orphans
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((r) => items.push(new ReportItem(r)));
      return items;
    }
    return [];
  }
}
export class GroupItem extends vscode.TreeItem {
  constructor(public readonly label: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}
export class ReportItem extends vscode.TreeItem {
  constructor(public readonly report: ReportData) {
    super(report.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'report';
    this.iconPath = new vscode.ThemeIcon('report');
    this.command = {
      command: 'sqlnotebook.openReport',
      title: 'Open Report',
      arguments: [report],
    };
  }
}
