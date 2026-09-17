import * as mysql from 'mysql2/promise';
import * as pg from 'pg';
import * as mssql from 'mssql';
import initSqlJs from 'sql.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import type { Database as SqliteDatabase } from 'sql.js';
import * as path from 'path';
import * as vscode from 'vscode';
import { createTunnel } from 'tunnel-ssh';
const trinoLib = require('@trinodb/trino-js-client');
const supportedDrivers = [
  'mysql',
  'postgres',
  'mssql',
  'sqlite',
  'trino',
] as const;
export type DriverKey = (typeof supportedDrivers)[number];
export type TableSchema = {
  table: string;
  columns: string[];
  columnTypes?: Record<string, string>;
  schema?: string;
  foreignKeys?: ForeignKey[];
  primaryKeys?: string[];
  type?: 'table' | 'view' | 'procedure' | 'function';
};
export type ForeignKey = {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  schema?: string;
  referencedSchema?: string;
};
export interface Pool {
  getConnection: () => Promise<Conn>;
  end: () => void;
  getSchema: () => Promise<TableSchema[]>;
}
export type ExecutionResult = TabularResult[];
export type TableData = {
  rows: Row[] | any[][];
  columns?: string[];
};
export type TabularResult = Row[] | TableData;
export type Row = { [key: string]: any };
interface Conn {
  release: () => void;
  query: (q: string) => Promise<ExecutionResult>;
  destroy: () => void;
}
export type PoolConfig =
  SqliteConfig | MySQLConfig | MSSQLConfig | PostgresConfig | TrinoConfig;
export async function getPool(c: PoolConfig & any): Promise<Pool> {
  let tunnelServer: any = null;
  if (c.enableSsh && c.driver !== 'sqlite') {
    const tunnelOptions: any = { autoClose: true, reconnectOnError: false };
    const serverOptions = { port: 0 };
    const sshOptions: any = {
      host: c.sshHost,
      port: c.sshPort || 22,
      username: c.sshUser,
    };
    if (c.sshPassword) {
      sshOptions.password = c.sshPassword;
    }
    if (c.sshKey) {
      sshOptions.privateKey = fsSync.readFileSync(c.sshKey);
    }
    const forwardOptions = {
      srcAddr: '127.0.0.1',
      srcPort: 0,
      dstAddr: c.host,
      dstPort: c.port,
    };
    
    try {
      const [server] = await createTunnel(tunnelOptions, serverOptions, sshOptions, forwardOptions);
      tunnelServer = server;
      c.host = '127.0.0.1';
      c.port = (server?.address() as any)?.port;
    } catch (e: any) {
      throw new Error(`SSH Tunnel failed: ${e.message}`);
    }
  }

  let pool: Pool;
  switch (c.driver) {
    case 'mysql':
      pool = await createMySQLPool(c); break;
    case 'mssql':
      pool = await createMSSQLPool(c); break;
    case 'postgres':
      pool = await createPostgresPool(c); break;
    case 'sqlite':
      pool = await createSqLitePool(c); break;
    case 'trino':
      pool = await createTrinoPool(c); break;
    default:
      throw Error('invalid driver key');
  }

  if (tunnelServer) {
    const originalEnd = pool.end;
    pool.end = () => {
      try { originalEnd.call(pool); } catch (e) {}
      try { tunnelServer.close(); } catch (e) {}
    };
  }
  return pool;
}
interface BaseConfig {
  driver: DriverKey;
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  queryTimeout: number;
}
interface SqliteConfig {
  driver: 'sqlite';
  path: string;
}
async function createSqLitePool({
  path: filepath,
}: SqliteConfig): Promise<Pool> {
  const sqlite = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
  });
  if (filepath === ':memory:') {
    return sqlitePool(new sqlite.Database());
  }
  let fullPath = filepath;
  if (!path.isAbsolute(filepath)) {
    fullPath = path.resolve(workspaceRoot(), filepath);
    if (!fullPath.startsWith(workspaceRoot()) && workspaceRoot() !== '') {
      throw new Error(
        'Security Error: SQLite path must be within the workspace folder.',
      );
    }
  }

  const buff = await fs.readFile(fullPath);
  const db = new sqlite.Database(buff);
  return sqlitePool(db, fullPath);
}
const workspaceRoot = () =>
  (vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders[0]?.uri.fsPath) ||
  '';
function sqlitePool(pool: SqliteDatabase, dbFile?: string): Pool {
  return {
    async getConnection(): Promise<Conn> {
      return sqliteConn(pool, dbFile);
    },
    end: () => {
      pool.close();
    },
    async getSchema(): Promise<TableSchema[]> {
      const objects: TableSchema[] = [];
      try {
        const resTables = pool.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        );
        if (resTables.length && resTables[0].values) {
          for (const row of resTables[0].values) {
            const tableName = row[0] as string;
            const resCols = pool.exec(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`);
            const columns: string[] = [];
            const columnTypes: Record<string, string> = {};
            const primaryKeys: string[] = [];
            if (!resCols || resCols.length === 0 || !resCols[0].values) {
              continue;
            }
            if (resCols.length && resCols[0].values) {
              for (const c of resCols[0].values) {
                columns.push(c[1] as string);
                columnTypes[c[1] as string] = c[2] as string;
                if (c[5]) {
                  primaryKeys.push(c[1] as string);
                }
              }
            }
            objects.push({
              table: tableName,
              columns,
              columnTypes,
              primaryKeys,
              type: 'table',
            });
          }
        }
        const resViews = pool.exec(
          "SELECT name FROM sqlite_master WHERE type='view'",
        );
        if (resViews.length && resViews[0].values) {
          for (const row of resViews[0].values) {
            const viewName = row[0] as string;
            const resCols = pool.exec(`PRAGMA table_info("${viewName.replace(/"/g, '""')}")`);
            const columns: string[] = [];
            const columnTypes: Record<string, string> = {};
            if (resCols.length && resCols[0].values) {
              for (const c of resCols[0].values) {
                columns.push(c[1] as string);
                columnTypes[c[1] as string] = c[2] as string;
              }
            }
            objects.push({
              table: viewName,
              columns,
              columnTypes,
              type: 'view',
            });
          }
        }
      } catch (e) {
        console.error('Error fetching sqlite schema', e);
      }
      return objects;
    },
  };
}
function sqliteConn(conn: SqliteDatabase, dbFile?: string): Conn {
  return {
    async query(q: string): Promise<ExecutionResult> {
      const execResults = conn.exec(q);
      let affectedRows = 0;
      try {
        affectedRows = conn.getRowsModified();
      } catch (e) {}
      if (dbFile) {
        const data = conn.export();
        const buffer = Buffer.from(data);
        await fs.writeFile(dbFile, buffer);
      }
      if (execResults.length === 0) {
        return [
          [
            {
              Status: 'Success',
              RowsAffected: affectedRows,
              Message: 'Command executed successfully.',
            },
          ],
        ];
      }
      return execResults.map((res) => ({
        columns: res.columns,
        rows: res.values,
      }));
    },
    destroy: () => {},
    release: () => {},
  };
}
interface MySQLConfig extends BaseConfig {
  driver: 'mysql';
  multipleStatements: boolean;
}
async function createMySQLPool({
  host,
  port,
  user,
  password,
  database,
  multipleStatements,
  queryTimeout,
}: MySQLConfig): Promise<Pool> {
  const dbName = database;
  const pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    multipleStatements,
    typeCast(field, next) {
      switch (field.type) {
        case 'TIMESTAMP':
        case 'DATE':
        case 'DATETIME':
          return field.string();
        default:
          return next();
      }
    },
  });
  return mysqlPool(pool, queryTimeout, dbName);
}
function mysqlPool(
  pool: mysql.Pool,
  queryTimeout: number,
  dbName?: string,
): Pool {
  return {
    async getConnection(): Promise<Conn> {
      return mysqlConn(await pool.getConnection(), queryTimeout);
    },
    end() {
      pool.end();
    },
    async getSchema(): Promise<TableSchema[]> {
      let schemas: any[] = [];
      let tablesAndViews: any[] = [];
      let fkRows: any[] = [];
      let procedures: any[] = [];
      try {
        if (dbName) {
          schemas = [{ SCHEMA_NAME: dbName }];
        } else {
          const [allSchemas] = (await pool.query(
            `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')`,
          )) as unknown as [any[], any];
          schemas = allSchemas;
        }
        const dbFilter = dbName
          ? `= '${dbName.replace(/'/g, "''")}'`
          : `NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')`;
        [tablesAndViews] = (await pool.query(`
          SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.COLUMN_TYPE, c.TABLE_SCHEMA, t.TABLE_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS c
          JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
          WHERE c.TABLE_SCHEMA ${dbFilter}
        `)) as unknown as [any[], any];
        [fkRows] = (await pool.query(`
          SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, TABLE_SCHEMA, REFERENCED_TABLE_SCHEMA
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE REFERENCED_TABLE_NAME IS NOT NULL
            AND TABLE_SCHEMA ${dbFilter}
        `)) as unknown as [any[], any];
        [procedures] = (await pool.query(`
          SELECT SPECIFIC_NAME, ROUTINE_TYPE, ROUTINE_SCHEMA
          FROM INFORMATION_SCHEMA.ROUTINES
          WHERE ROUTINE_SCHEMA ${dbFilter}
        `)) as unknown as [any[], any];
      } catch (e) {
        console.error('Error fetching mysql schema', e);
        return [];
      }
      const map = new Map<string, TableSchema[]>();
      tablesAndViews?.forEach((r: any) => {
        if (!r || !r.TABLE_NAME) {
          return;
        }
        const obj: TableSchema = {
          table: r.TABLE_NAME,
          columns: [r.COLUMN_NAME],
          columnTypes: { [r.COLUMN_NAME]: r.COLUMN_TYPE || r.DATA_TYPE },
          schema: r.TABLE_SCHEMA,
          foreignKeys: [],
          type: r.TABLE_TYPE === 'VIEW' ? 'view' : 'table',
        };
        if (!map.has(r.TABLE_SCHEMA)) {
          map.set(r.TABLE_SCHEMA, []);
        }
        const arr = map.get(r.TABLE_SCHEMA)!;
        const existing = arr.find(
          (t) => t.table === r.TABLE_NAME && t.type === obj.type,
        );
        if (existing) {
          existing.columns.push(r.COLUMN_NAME);
          existing.columnTypes![r.COLUMN_NAME] = r.COLUMN_TYPE || r.DATA_TYPE;
        } else {
          arr.push(obj);
        }
      });
      fkRows?.forEach((r: any) => {
        const arr = map.get(r.TABLE_SCHEMA);
        if (!arr) {
          return;
        }
        const obj = arr.find((t) => t.table === r.TABLE_NAME);
        if (!obj) {
          return;
        }
        const entry: ForeignKey = {
          table: r.TABLE_NAME,
          column: r.COLUMN_NAME,
          referencedTable: r.REFERENCED_TABLE_NAME,
          referencedColumn: r.REFERENCED_COLUMN_NAME,
          schema: r.TABLE_SCHEMA,
          referencedSchema: r.REFERENCED_TABLE_SCHEMA,
        };
        obj.foreignKeys = obj.foreignKeys || [];
        obj.foreignKeys.push(entry);
      });
      procedures?.forEach((r: any) => {
        if (!map.has(r.ROUTINE_SCHEMA)) {
          map.set(r.ROUTINE_SCHEMA, []);
        }
        map.get(r.ROUTINE_SCHEMA)!.push({
          table: r.SPECIFIC_NAME,
          columns: [],
          schema: r.ROUTINE_SCHEMA,
          type: r.ROUTINE_TYPE === 'PROCEDURE' ? 'procedure' : 'function',
        });
      });
      schemas?.forEach((s: any) => {
        if (!map.has(s.SCHEMA_NAME)) {
          map.set(s.SCHEMA_NAME, []);
        }
      });
      const all: TableSchema[] = [];
      for (const [schema, arr] of map.entries()) {
        if (arr.length === 0) {
          all.push({ table: '', columns: [], schema, type: undefined });
        } else {
          all.push(...arr);
        }
      }
      return all;
    },
  };
}
function mysqlConn(conn: mysql.PoolConnection, queryTimeout: number): Conn {
  return {
    destroy() {
      conn.destroy();
    },
    async query(q: string): Promise<ExecutionResult> {
      const [result, ok] = (await conn.query({
        sql: q,
        timeout: queryTimeout,
        rowsAsArray: true,
      })) as unknown as [unknown[], any];
      const normalizeRows = (rows: unknown, fields: any): TabularResult => {
        if (!Array.isArray(rows)) {
          return [rows as Row];
        }
        const columns = Array.isArray(fields)
          ? fields.map((f: any) => f?.name ?? '')
          : undefined;
        return { rows, columns } as TableData;
      };
      if (!Array.isArray(result)) {
        return [[result as Row]];
      }
      if (!result.length) {
        return [normalizeRows(result, ok)];
      }
      const hasMultipleResults =
        Array.isArray(ok) && ok.length > 1 && ok.some((a: any) => a?.length);
      if (hasMultipleResults) {
        return result.map((res: any, idx: number) => {
          const fields = Array.isArray(ok) ? ok[idx] : ok;
          return res.length !== undefined
            ? normalizeRows(res, fields)
            : [res as Row];
        }) as ExecutionResult;
      }
      return [normalizeRows(result, ok)];
    },
    release() {
      conn.release();
    },
  };
}
interface PostgresConfig extends BaseConfig {
  driver: 'postgres';
}
const identity = <T>(input: T) => input;

async function createPostgresPool({
  host,
  port,
  user,
  password,
  database,
  queryTimeout,
}: PostgresConfig): Promise<Pool> {
  const pool = new pg.Pool({
    host,
    port,
    password,
    database,
    user,
    query_timeout: queryTimeout,
    types: {
      getTypeParser(id, format) {
        switch (id) {
          case pg.types.builtins.TIMESTAMP:
          case pg.types.builtins.TIMESTAMPTZ:
          case pg.types.builtins.TIME:
          case pg.types.builtins.TIMETZ:
          case pg.types.builtins.DATE:
          case pg.types.builtins.INTERVAL:
            return identity;
          default:
            return pg.types.getTypeParser(id, format);
        }
      },
    },
  });
  return postgresPool(pool, queryTimeout);
}

function postgresPool(pool: any, queryTimeout: number): Pool {
  return {
    async getConnection(): Promise<Conn> {
      const client = await pool.connect();
      return {
        async query(q: string): Promise<ExecutionResult> {
          const res = await client.query({
            text: q,
            rowMode: 'array',
            statement_timeout: queryTimeout,
          });
          if (Array.isArray(res.rows) && res.rows.length > 0) {
            return [
              { rows: res.rows, columns: res.fields?.map((f: any) => f.name) },
            ];
          }
          if (
            res.command &&
            ['INSERT', 'UPDATE', 'DELETE'].includes(res.command)
          ) {
            return [
              [
                {
                  Status: 'Success',
                  RowsAffected: res.rowCount,
                  Message: 'Command executed successfully.',
                },
              ],
            ];
          }
          return [
            [{ Status: 'Success', Message: 'Command executed successfully.' }],
          ];
        },
        destroy() {
          client.release();
        },
        release() {
          client.release();
        },
      };
    },
    end() {
      pool.end();
    },
    async getSchema(): Promise<TableSchema[]> {
      try {
        const schemasRes = await pool.query(
          `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema')`,
        );
        const schemas = schemasRes.rows.map((r: any) => r.schema_name);
        const tablesRes = await pool.query(`
          SELECT table_schema, table_name, table_type
          FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        `);
        const columnsRes = await pool.query(`
          SELECT table_schema, table_name, column_name, data_type
          FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        `);
        const fkRes = await pool.query(`
          SELECT
            tc.table_schema, tc.table_name, kcu.column_name,
            ccu.table_schema AS referenced_table_schema,
            ccu.table_name AS referenced_table,
            ccu.column_name AS referenced_column
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
        `);
        const pkRes = await pool.query(`
          SELECT
            tc.table_schema, tc.table_name, kcu.column_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
        `);
        const routinesRes = await pool.query(`
          SELECT routine_schema, routine_name, routine_type
          FROM information_schema.routines
          WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
        `);
        const map = new Map<string, TableSchema>();
        tablesRes.rows.forEach((t: any) => {
          const key = `${t.table_schema}.${t.table_name}`;
          map.set(key, {
            table: t.table_name,
            columns: [],
            columnTypes: {},
            schema: t.table_schema,
            foreignKeys: [],
            primaryKeys: [],
            type: t.table_type === 'VIEW' ? 'view' : 'table',
          });
        });
        columnsRes.rows.forEach((c: any) => {
          const key = `${c.table_schema}.${c.table_name}`;
          const obj = map.get(key);
          if (obj) {
            obj.columns.push(c.column_name);
            obj.columnTypes![c.column_name] = c.data_type;
          }
        });
        fkRes.rows.forEach((fk: any) => {
          const key = `${fk.table_schema}.${fk.table_name}`;
          const obj = map.get(key);
          if (obj) {
            obj.foreignKeys = obj.foreignKeys || [];
            obj.foreignKeys.push({
              table: fk.table_name,
              column: fk.column_name,
              referencedTable: fk.referenced_table,
              referencedColumn: fk.referenced_column,
              schema: fk.table_schema,
              referencedSchema: fk.referenced_table_schema,
            });
          }
        });
        pkRes.rows.forEach((pk: any) => {
          const key = `${pk.table_schema}.${pk.table_name}`;
          const obj = map.get(key);
          if (obj) {
            obj.primaryKeys = obj.primaryKeys || [];
            obj.primaryKeys.push(pk.column_name);
          }
        });
        routinesRes.rows.forEach((r: any) => {
          map.set(`${r.routine_schema}.${r.routine_name}`, {
            table: r.routine_name,
            columns: [],
            schema: r.routine_schema,
            type: r.routine_type === 'PROCEDURE' ? 'procedure' : 'function',
          });
        });
        return Array.from(map.values());
      } catch (e) {
        console.error('Error fetching postgres schema', e);
        return [];
      }
    },
  };
}
interface MSSQLConfig extends BaseConfig {
  driver: 'mssql';
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  legacyTls10?: boolean;
}
async function createMSSQLPool(config: MSSQLConfig): Promise<Pool> {
  const encrypt = config.encrypt !== false;
  const trustServerCertificate = config.trustServerCertificate === true;
  const minVersion = config.legacyTls10 ? 'TLSv1' : 'TLSv1.2';
  const pool = new mssql.ConnectionPool({
    server: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    requestTimeout: config.queryTimeout,
    options: {
      encrypt,
      trustServerCertificate,
      cryptoCredentialsDetails: {
        minVersion,
      },
    } as any,
  });
  await pool.connect();
  return mssqlPool(pool);
}
function mssqlPool(pool: mssql.ConnectionPool): Pool {
  return {
    async getConnection(): Promise<Conn> {
      const req = pool.request();
      return mssqlConn(req);
    },
    end() {
      pool.close();
    },
    async getSchema(): Promise<TableSchema[]> {
      try {
        // Tables and Views
        const res = await pool.query(`
          SELECT t.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_SCHEMA, t.TABLE_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS c
          JOIN INFORMATION_SCHEMA.TABLES t ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
        `);
        // Foreign Keys
        const fkRes = await pool.query(`
          SELECT
            sch.name AS table_schema,
            t.name AS table_name,
            c.name AS column_name,
            ref_sch.name AS referenced_table_schema,
            rt.name AS referenced_table_name,
            rc.name AS referenced_column_name
          FROM sys.foreign_key_columns fkc
          JOIN sys.tables t ON fkc.parent_object_id = t.object_id
          JOIN sys.schemas sch ON t.schema_id = sch.schema_id
          JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
          JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
          JOIN sys.schemas ref_sch ON rt.schema_id = ref_sch.schema_id
          JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
        `);
        // Primary Keys
        const pkRes = await pool.query(`
          SELECT
            sch.name AS table_schema,
            t.name AS table_name,
            c.name AS column_name
          FROM sys.indexes i
          JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
          JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          JOIN sys.tables t ON i.object_id = t.object_id
          JOIN sys.schemas sch ON t.schema_id = sch.schema_id
          WHERE i.is_primary_key = 1
        `);
        // Procedures and Functions
        const routinesRes = await pool.query(`
          SELECT SPECIFIC_NAME, ROUTINE_TYPE, ROUTINE_SCHEMA
          FROM INFORMATION_SCHEMA.ROUTINES
        `);
        const map = new Map<string, TableSchema>();
        res.recordset.forEach((r: any) => {
          const key = r.TABLE_NAME;
          if (!map.has(key)) {
            map.set(key, {
              table: r.TABLE_NAME,
              columns: [],
              columnTypes: {},
              schema: r.TABLE_SCHEMA,
              foreignKeys: [],
              primaryKeys: [],
              type: r.TABLE_TYPE === 'VIEW' ? 'view' : 'table',
            });
          }
          const obj = map.get(key)!;
          obj.columns.push(r.COLUMN_NAME);
          obj.columnTypes![r.COLUMN_NAME] = r.DATA_TYPE;
        });
        fkRes.recordset.forEach((r: any) => {
          const entry: ForeignKey = {
            table: r.table_name,
            column: r.column_name,
            referencedTable: r.referenced_table_name,
            referencedColumn: r.referenced_column_name,
            schema: r.table_schema,
            referencedSchema: r.referenced_table_schema,
          };
          if (map.has(r.table_name)) {
            map.get(r.table_name)!.foreignKeys =
              map.get(r.table_name)!.foreignKeys || [];
            map.get(r.table_name)!.foreignKeys!.push(entry);
          }
        });
        pkRes.recordset.forEach((r: any) => {
          if (map.has(r.table_name)) {
            map.get(r.table_name)!.primaryKeys =
              map.get(r.table_name)!.primaryKeys || [];
            map.get(r.table_name)!.primaryKeys!.push(r.column_name);
          }
        });
        routinesRes.recordset.forEach((r: any) => {
          map.set(r.SPECIFIC_NAME, {
            table: r.SPECIFIC_NAME,
            columns: [],
            schema: r.ROUTINE_SCHEMA,
            type: r.ROUTINE_TYPE === 'PROCEDURE' ? 'procedure' : 'function',
          });
        });
        return Array.from(map.values());
      } catch (e) {
        console.error('Error fetching mssql schema', e);
        return [];
      }
    },
  };
}
function mssqlConn(req: mssql.Request): Conn {
  return {
    destroy() {
      req.cancel();
    },
    async query(q: string): Promise<ExecutionResult> {
      const getColumnsFromResult = (
        result: any,
        recordset: any,
      ): string[] | undefined => {
        const sources = [
          recordset?.columns,
          recordset?.columnMetadata,
          recordset?.meta,
          result?.columns,
          result?.columnMetadata,
          result?.meta,
        ];
        for (const meta of sources) {
          if (!meta) {
            continue;
          }
          if (Array.isArray(meta)) {
            return meta.map((col) => {
              if (typeof col === 'string') {
                return col;
              }
              return (
                col?.name ?? col?.colName ?? col?.columnName ?? col?.label ?? ''
              );
            });
          }
          if (typeof meta === 'object') {
            const list = Object.values(meta) as any[];
            if (list.length > 0) {
              return list
                .sort((a, b) => {
                  const aOrder =
                    a?.index ??
                    a?.ordinal ??
                    a?.colnum ??
                    a?.colNum ??
                    a?.columnId ??
                    a?.id ??
                    a?.order ??
                    0;
                  const bOrder =
                    b?.index ??
                    b?.ordinal ??
                    b?.colnum ??
                    b?.colNum ??
                    b?.columnId ??
                    b?.id ??
                    b?.order ??
                    0;
                  return aOrder - bOrder;
                })
                .map(
                  (col) =>
                    col?.name ??
                    col?.colName ??
                    col?.columnName ??
                    col?.label ??
                    '',
                );
            }
          }
        }
        return undefined;
      };
      (req as unknown as { arrayRowMode: boolean }).arrayRowMode = true;
      const res = (await req.query(q)) as any;
      if (res.recordsets && res.recordsets.length > 0) {
        return res.recordsets.map((rs: any) => {
          const columns = getColumnsFromResult(res, rs);
          return {
            rows: rs,
            columns: columns && columns.length > 0 ? columns : undefined,
          };
        });
      }
      if (res.rowsAffected) {
        const statementInfos = getStatementInfos(q);
        if (Array.isArray(res.rowsAffected) && res.rowsAffected.length > 1) {
          const details = res.rowsAffected.map(
            (count: number, index: number) => {
              const info = statementInfos[index];
              if (info) {
                return {
                  Step: info.label,
                  RowsAffected: count,
                  Type: info.type,
                };
              }
              let stepLabel = `Trigger / Internal (Seq ${index + 1})`;
              if (statementInfos.length === 1) {
                stepLabel = `Trigger Execution (caused by ${statementInfos[0].type})`;
              }
              return {
                Step: stepLabel,
                RowsAffected: count,
                Type: 'Trigger',
              };
            },
          );
          return [details];
        }
        const val = Array.isArray(res.rowsAffected)
          ? res.rowsAffected[0]
          : res.rowsAffected;
        return [
          [
            {
              Status: 'Success',
              RowsAffected: val,
              Type: statementInfos[0]?.type || 'Statement',
              Target: statementInfos[0]?.label || 'Operation',
              Message: 'Query executed successfully.',
            },
          ],
        ];
      }
      return [
        [
          {
            Status: 'Success',
            Message: 'Command executed successfully.',
          },
        ],
      ];
    },
    release() {},
  };
}
export function getStatementInfos(
  sql: string,
): Array<{ type: string; label: string }> {
  const statements = splitSqlStatements(sql);
  return statements.map((s) => getStatementInfo(s));
}
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBracket = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        current += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBracket && !inBacktick) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }
    if (!inDouble && !inBracket && !inBacktick && ch === "'") {
      if (inSingle && next === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (!inSingle && !inBracket && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && ch === '[') {
      inBracket = true;
      current += ch;
      continue;
    } else if (
      !inSingle &&
      !inDouble &&
      !inBacktick &&
      inBracket &&
      ch === ']'
    ) {
      inBracket = false;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble && !inBracket && ch === '`') {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }
    if (ch === ';' && !inSingle && !inDouble && !inBracket && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }
    current += ch;
  }
  const finalTrimmed = current.trim();
  if (finalTrimmed.length > 0) {
    statements.push(finalTrimmed);
  }
  return statements;
}
function getStatementInfo(statement: string): { type: string; label: string } {
  const cleaned = statement.trim();
  if (!cleaned) {
    return { type: 'Statement', label: 'Operation' };
  }
  const namePat = '([#\\w.\\[\\]"`]+)';
  const useMatch = cleaned.match(new RegExp(`\\bUSE\\s+${namePat}`, 'i'));
  if (useMatch) {
    return { type: 'USE', label: `USE ${useMatch[1]}` };
  }
  const ddlMatch = cleaned.match(
    new RegExp(
      `\\b(CREATE|ALTER|DROP|TRUNCATE)\\s+(?:TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?${namePat}`,
      'i',
    ),
  );
  if (ddlMatch) {
    const type = `${ddlMatch[1].toUpperCase()} TABLE`;
    const target = ddlMatch[2];
    return { type, label: `${type} ${target}` };
  }
  const insertMatch = cleaned.match(
    new RegExp(`\\bINSERT\\s+INTO\\s+${namePat}`, 'i'),
  );
  if (insertMatch) {
    return { type: 'INSERT', label: `INSERT ${insertMatch[1]}` };
  }
  const updateMatch = cleaned.match(new RegExp(`\\bUPDATE\\s+${namePat}`, 'i'));
  if (updateMatch) {
    return { type: 'UPDATE', label: `UPDATE ${updateMatch[1]}` };
  }
  const deleteMatch = cleaned.match(
    new RegExp(`\\bDELETE\\s+FROM\\s+${namePat}`, 'i'),
  );
  if (deleteMatch) {
    return { type: 'DELETE', label: `DELETE ${deleteMatch[1]}` };
  }
  const mergeMatch = cleaned.match(
    new RegExp(`\\bMERGE\\s+INTO\\s+${namePat}`, 'i'),
  );
  if (mergeMatch) {
    return { type: 'MERGE', label: `MERGE ${mergeMatch[1]}` };
  }
  const execMatch = cleaned.match(
    new RegExp(`\\bEXEC(?:UTE)?\\s+${namePat}`, 'i'),
  );
  if (execMatch) {
    return { type: 'EXEC', label: `EXEC ${execMatch[1]}` };
  }
  const selectMatch = cleaned.match(/\bSELECT\b/i);
  if (selectMatch) {
    return { type: 'SELECT', label: 'SELECT' };
  }
  const keywordMatch = cleaned.match(
    /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|SELECT|SHOW|DESCRIBE|EXPLAIN|PRAGMA)\b/i,
  );
  if (keywordMatch) {
    const keyword = keywordMatch[1].toUpperCase();
    return { type: keyword, label: keyword };
  }
  return { type: 'Statement', label: 'Operation' };
}
interface TrinoConfig extends BaseConfig {
  driver: 'trino';
}
function parseTrinoCatalogSchema(database?: string): {
  catalog?: string;
  schema?: string;
} {
  const raw = (database || '').trim();
  if (!raw || raw === '*' || raw.toLowerCase() === 'all') {
    return {};
  }
  if (raw.includes('/')) {
    const [catalog, schema] = raw.split('/').map((v) => v.trim());
    return { catalog: catalog || undefined, schema: schema || undefined };
  }
  if (raw.includes('.')) {
    const [catalog, schema] = raw.split('.').map((v) => v.trim());
    return { catalog: catalog || undefined, schema: schema || undefined };
  }
  return { catalog: raw };
}
function buildTrinoServer(hostInput: string, port: number): string {
  const trimmedHost = (hostInput || '').trim();
  const defaultProtocol = port === 443 ? 'https' : 'http';
  const hasScheme = /^https?:\/\//i.test(trimmedHost);
  const parsed = new URL(
    hasScheme ? trimmedHost : `${defaultProtocol}://${trimmedHost}`,
  );
  if (!parsed.port && Number.isFinite(port) && port > 0) {
    parsed.port = String(port);
  }
  let basePath = parsed.pathname || '';
  if (basePath.endsWith('/v1/statement')) {
    basePath = basePath.slice(0, -'/v1/statement'.length);
  }
  basePath = basePath.replace(/\/+$/, '');
  return `${parsed.protocol}//${parsed.host}${basePath}`;
}
function quoteTrinoIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
async function createTrinoPool(config: TrinoConfig): Promise<Pool> {
  return trinoPool(config);
}
function trinoPool(config: TrinoConfig): Pool {
  return {
    async getConnection(): Promise<Conn> {
      return trinoConn(config);
    },
    end() {},
    async getSchema(): Promise<TableSchema[]> {
      try {
        const configured = parseTrinoCatalogSchema(config.database);
        let catalogsToScan: string[] = [];
        if (configured.catalog) {
          catalogsToScan = [configured.catalog];
        } else {
          const discoveryClient = resolveTrinoClient(
            config,
            'information_schema',
          );
          const catalogsResult = await runTrinoQuery(
            discoveryClient,
            'SHOW CATALOGS',
          );
          const catalogsTabular = catalogsResult[0] as any;
          catalogsToScan =
            catalogsTabular &&
            typeof catalogsTabular === 'object' &&
            'rows' in catalogsTabular &&
            Array.isArray(catalogsTabular.rows)
              ? catalogsTabular.rows.map((r: any[]) => String(r[0]))
              : [];
        }
        const map = new Map<string, TableSchema[]>();
        for (const catalog of catalogsToScan) {
          let schemas: string[] = [];
          if (configured.schema) {
            schemas = [configured.schema];
          } else {
            const discoveryClient = resolveTrinoClient(
              config,
              'information_schema',
            );
            try {
              const schemasResult = await runTrinoQuery(
                discoveryClient,
                `SHOW SCHEMAS FROM ${quoteTrinoIdentifier(catalog)}`,
              );
              const schemasTabular = schemasResult[0] as any;
              schemas =
                schemasTabular &&
                typeof schemasTabular === 'object' &&
                'rows' in schemasTabular &&
                Array.isArray(schemasTabular.rows)
                  ? schemasTabular.rows.map((r: any[]) => String(r[0]))
                  : [];
            } catch (e) {
              continue;
            }
          }
          const schemaFilter =
            schemas.length === 1
              ? `= '${schemas[0].replace(/'/g, "''")}'`
              : `NOT IN ('information_schema', 'sys')`;
          const discoveryClient2 = resolveTrinoClient(
            config,
            catalog + '.information_schema',
          );
          const query = `SELECT table_schema, table_name, column_name, data_type, table_type FROM ${quoteTrinoIdentifier(catalog)}.information_schema.columns c JOIN ${quoteTrinoIdentifier(catalog)}.information_schema.tables t ON c.table_schema = t.table_schema AND c.table_name = t.table_name WHERE c.table_schema ${schemaFilter}`;
          let rows: any[] = [];
          try {
            const result = await runTrinoQuery(discoveryClient2, query);
            const tabular = result[0] as any;
            rows =
              tabular &&
              typeof tabular === 'object' &&
              'rows' in tabular &&
              Array.isArray(tabular.rows)
                ? tabular.rows
                : [];
          } catch (catalogError) {
            continue;
          }
          rows.forEach((r: any) => {
            const schemaName = String(r[0]);
            const tableName = String(r[1]);
            const columnName = String(r[2]);
            const dataType = String(r[3]);
            const tableType = String(r[4] || '').toUpperCase();
            if (!map.has(`${catalog}.${schemaName}`)) {
              map.set(`${catalog}.${schemaName}`, []);
            }
            const arr = map.get(`${catalog}.${schemaName}`)!;
            let obj = arr.find(
              (t) =>
                t.table === tableName &&
                t.type === (tableType === 'VIEW' ? 'view' : 'table'),
            );
            if (!obj) {
              obj = {
                table: tableName,
                schema: `${catalog}.${schemaName}`,
                columns: [],
                columnTypes: {},
                type: tableType === 'VIEW' ? 'view' : 'table',
              };
              arr.push(obj);
            }
            obj.columns.push(columnName);
            obj.columnTypes![columnName] = dataType;
          });
          schemas.forEach((schemaName: string) => {
            if (!map.has(`${catalog}.${schemaName}`)) {
              map.set(`${catalog}.${schemaName}`, []);
            }
          });
        }
        const all: TableSchema[] = [];
        for (const [schema, arr] of map.entries()) {
          if (arr.length === 0) {
            all.push({ table: '', columns: [], schema, type: undefined });
          } else {
            all.push(...arr);
          }
        }
        return all;
      } catch (e) {
        console.error('Error fetching trino schema', e);
        return [];
      }
    },
  };
}
function trinoConn(config: TrinoConfig): Conn {
  const client = resolveTrinoClient(config);
  return {
    async query(q: string): Promise<ExecutionResult> {
      return runTrinoQuery(client, q);
    },
    release() {},
    destroy() {},
  };
}
function resolveTrinoClient(config: TrinoConfig, schemaOverride?: string): any {
  const parsed = parseTrinoCatalogSchema(config.database);
  const catalog = parsed.catalog || 'system';
  const schema =
    schemaOverride ||
    parsed.schema ||
    (catalog === 'system' ? 'runtime' : 'default');
  const server = buildTrinoServer(config.host, config.port);

  const opts = {
    server,
    catalog,
    schema: schema,
    auth: new trinoLib.BasicAuth(config.user, config.password || ''),
  };
  if (trinoLib.Trino && typeof trinoLib.Trino.create === 'function') {
    return trinoLib.Trino.create(opts);
  }
  throw new Error(
    'No se pudo encontrar el constructor Trino o el método create en la librería.',
  );
}
async function runTrinoQuery(client: any, q: string): Promise<ExecutionResult> {
  const rows: any[] = [];
  let columns: string[] = [];
  try {
    if (!client || typeof client.query !== 'function') {
      console.error('Trino client object:', client);
      throw new Error(
        'Trino client does not have a query method. Check @trinodb/trino-js-client version and usage.',
      );
    }
    const iterator = await client.query(q);
    if (!iterator || typeof iterator[Symbol.asyncIterator] !== 'function') {
      console.error('Trino query did not return an async iterator:', iterator);
      throw new Error('Trino client query did not return an async iterator.');
    }
    for await (const result of iterator) {
      if (!result) {
        continue;
      }
      if (result.error) {
        console.error('[Trino][ERROR]', result.error);
        return [
          [
            {
              Status: '❌ Error',
              Message: result.error.message || 'Unknown Trino error',
              ErrorCode: result.error.errorCode,
              ErrorName: result.error.errorName,
              ErrorType: result.error.errorType,
            },
          ],
        ];
      }
      if (result.columns && columns.length === 0) {
        columns = result.columns.map((c: any) => c.name);
      }
      if (result.data) {
        rows.push(...result.data);
      }
    }
    return [{ rows, columns }];
  } catch (err: any) {
    console.error('Trino Query Error:', err);
    throw err;
  }
}
