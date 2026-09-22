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
    this.tooltip = `Report: ${report.name} (${report.datasets?.length || 0} datasets)`;
    this.command = {
      command: 'sqlnotebook.openReport',
      title: 'Open Report',
      arguments: [report],
    };
  }
}

export function exportReportToRdlXml(report: ReportData): string {
  const dataSetsXml = (report.datasets || [])
    .map((ds, idx) => {
      const dsName =
        ds.name.replace(/[^a-zA-Z0-9_]/g, '') || `DataSet${idx + 1}`;
      return `    <DataSet Name="${escapeXml(dsName)}">
      <Query>
        <DataSourceName>SQLNotebookDataSource</DataSourceName>
        <CommandText>${escapeXml(ds.query)}</CommandText>
      </Query>
    </DataSet>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">
  <AutoRefresh>${report.refreshInterval || 0}</AutoRefresh>
  <DataSources>
    <DataSource Name="SQLNotebookDataSource">
      <ConnectionProperties>
        <DataProvider>SQL</DataProvider>
        <ConnectString></ConnectString>
      </ConnectionProperties>
      <rd:SecurityType>None</rd:SecurityType>
    </DataSource>
  </DataSources>
  <DataSets>
${dataSetsXml}
  </DataSets>
  <ReportSections>
    <ReportSection>
      <Body>
        <Height>8in</Height>
      </Body>
      <Width>10in</Width>
      <Page>
        <PageHeight>8.5in</PageHeight>
        <PageWidth>11in</PageWidth>
      </Page>
    </ReportSection>
  </ReportSections>
</Report>`;
}

export function importRdlXmlToReport(
  xmlText: string,
  fileName: string,
): ReportData {
  const reportName = fileName.replace(/\.rdl$/i, '') || 'Imported RDL Report';
  const datasets: ReportDataset[] = [];

  const dsRegex = /<DataSet\s+Name=["']([^"']+)["']>([\s\S]*?)<\/DataSet>/gi;
  let match: RegExpExecArray | null;

  while ((match = dsRegex.exec(xmlText)) !== null) {
    const dsName = match[1];
    const dsBody = match[2];
    const queryMatch = dsBody.match(/<CommandText>([\s\S]*?)<\/CommandText>/i);
    const query = queryMatch ? unescapeXml(queryMatch[1].trim()) : 'SELECT 1;';

    datasets.push({
      name: dsName,
      connectionName: '',
      query: query,
      width: 'full',
      type: 'table',
    });
  }

  if (datasets.length === 0) {
    const simpleQueryMatch = xmlText.match(
      /<CommandText>([\s\S]*?)<\/CommandText>/i,
    );
    if (simpleQueryMatch) {
      datasets.push({
        name: 'DataSet1',
        connectionName: '',
        query: unescapeXml(simpleQueryMatch[1].trim()),
        width: 'full',
        type: 'table',
      });
    }
  }

  return {
    name: reportName,
    datasets:
      datasets.length > 0
        ? datasets
        : [
            {
              name: 'DataSet1',
              connectionName: '',
              query: 'SELECT 1;',
              width: 'full',
              type: 'table',
            },
          ],
  };
}

function escapeXml(unsafe: string): string {
  return (unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(safe: string): string {
  return (safe || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
