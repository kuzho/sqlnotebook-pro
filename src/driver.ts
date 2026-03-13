import * as mysql from 'mysql2/promise';
import * as pg from 'pg';
import * as mssql from 'mssql';
import initSqlJs from 'sql.js';
import * as fs from 'fs/promises';
import type { Database as SqliteDatabase } from 'sql.js';
import * as path from 'path';
import * as vscode from 'vscode';

const trinoLib = require('trino-client');

const supportedDrivers = ['mysql', 'postgres', 'mssql', 'sqlite', 'trino'] as const;
export type DriverKey = typeof supportedDrivers[number];

export type TableSchema = {
  table: string;
  columns: string[];
  schema?: string;
  foreignKeys?: ForeignKey[];
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
  | SqliteConfig
  | MySQLConfig
  | MSSQLConfig
  | PostgresConfig
  | TrinoConfig;

export async function getPool(c: PoolConfig): Promise<Pool> {
  switch (c.driver) {
    case 'mysql':
      return createMySQLPool(c);
    case 'mssql':
      return createMSSQLPool(c);
    case 'postgres':
      return createPostgresPool(c);
    case 'sqlite':
      return createSqLitePool(c);
    case 'trino':
      return createTrinoPool(c);
    default:
      throw Error('invalid driver key');
  }
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

  const fullPath = path.resolve(workspaceRoot(), filepath);
  console.log('[DEBUG][SQLite] Opening DB at path:', fullPath);
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
      const tables: TableSchema[] = [];
      try {
        const resTables = pool.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        if (resTables.length && resTables[0].values) {
          for (const row of resTables[0].values) {
            const tableName = row[0] as string;
            const resCols = pool.exec(`PRAGMA table_info("${tableName}")`);
            const columns = resCols.length && resCols[0].values 
                ? resCols[0].values.map(c => c[1] as string) 
                : [];
            tables.push({ table: tableName, columns });
          }
        }
      } catch (e) {
        console.error('Error fetching sqlite schema', e);
      }
      return tables;
    }
  };
}

function sqliteConn(conn: SqliteDatabase, dbFile?: string): Conn {
  return {
        async query(q: string): Promise<ExecutionResult> {
          const stm = conn.prepare(q);
          const columns = stm.getColumnNames();
          const result: any[][] = [];

          let isSelect = /^\s*select/i.test(q);
          let affectedRows = 0;

          while (stm.step()) {
            result.push(stm.get());
            if (!isSelect) affectedRows++;
          }

          stm.free();
          if (isSelect) {
            console.log(`[DEBUG][SQLite] SELECT returned ${result.length} rows.`);
          } else {
            console.log(`[DEBUG][SQLite] Non-SELECT affected ${affectedRows} rows.`);
          }

          if (dbFile) {
            const data = conn.export();
            const buffer = Buffer.from(data);
            await fs.writeFile(dbFile, buffer);
            console.log('[DEBUG][SQLite] Database written to:', dbFile);
          }

          return [{ rows: result, columns }];
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
  return mysqlPool(
    mysql.createPool({
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
    }),
    queryTimeout
  );
}

function mysqlPool(pool: mysql.Pool, queryTimeout: number): Pool {
  return {
    async getConnection(): Promise<Conn> {
      return mysqlConn(await pool.getConnection(), queryTimeout);
    },
    end() {
      pool.end();
    },
    async getSchema(): Promise<TableSchema[]> {
      try {
        const [rows] = await pool.query(`
          SELECT TABLE_NAME, COLUMN_NAME, TABLE_SCHEMA
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
        `) as any;

        const [fkRows] = await pool.query(`
          SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, TABLE_SCHEMA, REFERENCED_TABLE_SCHEMA
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
        `) as any;

        const map = new Map<string, string[]>();
        const schemaMap = new Map<string, string>();
        const fkMap = new Map<string, ForeignKey[]>();
        rows.forEach((r: any) => {
          if (!map.has(r.TABLE_NAME)) {
            map.set(r.TABLE_NAME, []);
          }
          map.get(r.TABLE_NAME)?.push(r.COLUMN_NAME);
          if (!schemaMap.has(r.TABLE_NAME)) {
            schemaMap.set(r.TABLE_NAME, r.TABLE_SCHEMA);
          }
        });

        fkRows.forEach((r: any) => {
          const entry: ForeignKey = {
            table: r.TABLE_NAME,
            column: r.COLUMN_NAME,
            referencedTable: r.REFERENCED_TABLE_NAME,
            referencedColumn: r.REFERENCED_COLUMN_NAME,
            schema: r.TABLE_SCHEMA,
            referencedSchema: r.REFERENCED_TABLE_SCHEMA
          };
          if (!fkMap.has(r.TABLE_NAME)) {
            fkMap.set(r.TABLE_NAME, []);
          }
          fkMap.get(r.TABLE_NAME)?.push(entry);
        });

        return Array.from(map.entries()).map(([table, columns]) => ({
          table,
          columns,
          schema: schemaMap.get(table),
          foreignKeys: fkMap.get(table) || []
        }));
      } catch (e) {
        console.error('Error fetching mysql schema', e);
        return [];
      }
    }
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
      })) as any;
      console.debug('mysql query result', { result, ok });

      const normalizeRows = (rows: any, fields: any) => {
        if (!Array.isArray(rows)) {
          return rows;
        }
        const columns = Array.isArray(fields)
          ? fields.map((f: any) => f?.name ?? '')
          : undefined;
        return { rows, columns } as TableData;
      };

      if (!Array.isArray(result)) {
        return [[result]];
      }

      if (!result.length) {
        return [normalizeRows(result, ok)];
      }

      const hasMultipleResults =
        Array.isArray(ok) && ok.length > 1 && ok.some((a: any) => a?.length);
      if (hasMultipleResults) {
        return result.map((res: any, idx: number) => {
          const fields = Array.isArray(ok) ? ok[idx] : ok;
          return res.length !== undefined ? normalizeRows(res, fields) : [res];
        });
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
  return postgresPool(pool);
}

function postgresPool(pool: pg.Pool): Pool {
  return {
    async getConnection(): Promise<Conn> {
      const conn = await pool.connect();
      return postgresConn(conn);
    },
    end() {
      pool.end();
    },
    async getSchema(): Promise<TableSchema[]> {
      try {
        const res = await pool.query(`
          SELECT table_schema, table_name, column_name
          FROM information_schema.columns
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        `);

        const map = new Map<string, TableSchema>();
        res.rows.forEach(r => {
          const key = `${r.table_schema}.${r.table_name}`;
          if (!map.has(key)) {
            map.set(key, {
              table: r.table_name,
              schema: r.table_schema,
              columns: []
            });
          }
          map.get(key)?.columns.push(r.column_name);
        });
        return Array.from(map.values());
      } catch (e) {
        console.error('Error fetching pg schema', e);
        return [];
      }
    }
  };
}

function postgresConn(conn: pg.PoolClient): Conn {
  return {
    async query(q: string): Promise<ExecutionResult> {
      const response = (await conn.query({ text: q, rowMode: 'array' })) as any as pg.QueryResult<any>[];
      console.debug('pg query response', { response });

      const maybeResponses = !!response.length
        ? response
        : ([response] as any as pg.QueryResult<any>[]);

      return maybeResponses.map(({ rows, rowCount, fields }) => {
        if (!rows.length) {
          return rowCount !== null ? [{ rowCount: rowCount }] : [];
        }

        const columns = Array.isArray(fields)
          ? fields.map(f => f?.name ?? '')
          : undefined;
        return { rows, columns } as TableData;
      });
    },
    destroy() {
      conn.release();
    },
    release() {
      conn.release();
    },
  };
}

interface MSSQLConfig extends BaseConfig {
  driver: 'mssql';
  encrypt: boolean;
  trustServerCertificate: boolean;
}

async function createMSSQLPool(config: MSSQLConfig): Promise<Pool> {
  const pool = new mssql.ConnectionPool({
    server: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    requestTimeout: config.queryTimeout,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
      cryptoCredentialsDetails: {
        minVersion: 'TLSv1'
      }
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
        const res = await pool.query(`
          SELECT TABLE_NAME, COLUMN_NAME, TABLE_SCHEMA
          FROM INFORMATION_SCHEMA.COLUMNS
        `);

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

        const map = new Map<string, string[]>();
        const schemaMap = new Map<string, string>();
        const fkMap = new Map<string, ForeignKey[]>();
        res.recordset.forEach((r: any) => {
          if (!map.has(r.TABLE_NAME)) {
            map.set(r.TABLE_NAME, []);
          }
          map.get(r.TABLE_NAME)?.push(r.COLUMN_NAME);
          if (!schemaMap.has(r.TABLE_NAME)) {
            schemaMap.set(r.TABLE_NAME, r.TABLE_SCHEMA);
          }
        });

        fkRes.recordset.forEach((r: any) => {
          const entry: ForeignKey = {
            table: r.table_name,
            column: r.column_name,
            referencedTable: r.referenced_table_name,
            referencedColumn: r.referenced_column_name,
            schema: r.table_schema,
            referencedSchema: r.referenced_table_schema
          };
          if (!fkMap.has(r.table_name)) {
            fkMap.set(r.table_name, []);
          }
          fkMap.get(r.table_name)?.push(entry);
        });

        return Array.from(map.entries()).map(([table, columns]) => ({
          table,
          columns,
          schema: schemaMap.get(table),
          foreignKeys: fkMap.get(table) || []
        }));
      } catch(e) {
        console.error('Error fetching mssql schema', e);
        return [];
      }
    }
  };
}

function mssqlConn(req: mssql.Request): Conn {
  return {
    destroy() {
      req.cancel();
    },
    async query(q: string): Promise<ExecutionResult> {
      const getColumnsFromResult = (result: any, recordset: any): string[] | undefined => {
        const sources = [
          recordset?.columns,
          recordset?.columnMetadata,
          recordset?.meta,
          result?.columns,
          result?.columnMetadata,
          result?.meta
        ];

        for (const meta of sources) {
          if (!meta) {
            continue;
          }
          if (Array.isArray(meta)) {
            return meta.map(col => {
              if (typeof col === 'string') {
                return col;
              }
              return col?.name ?? col?.colName ?? col?.columnName ?? col?.label ?? '';
            });
          }
          if (typeof meta === 'object') {
            const list = Object.values(meta) as any[];
            if (list.length > 0) {
              return list
                .sort((a, b) => {
                  const aOrder = a?.index ?? a?.ordinal ?? a?.colnum ?? a?.colNum ?? a?.columnId ?? a?.id ?? a?.order ?? 0;
                  const bOrder = b?.index ?? b?.ordinal ?? b?.colnum ?? b?.colNum ?? b?.columnId ?? b?.id ?? b?.order ?? 0;
                  return aOrder - bOrder;
                })
                .map(col => col?.name ?? col?.colName ?? col?.columnName ?? col?.label ?? '');
            }
          }
        }
        return undefined;
      };

      (req as any).arrayRowMode = true;
      const res: any = await req.query(q);

        if (res.recordsets && res.recordsets.length > 0) {
          const recordset = res.recordsets[0];
          const columns = getColumnsFromResult(res, recordset);
          return [{ rows: recordset, columns }];
        }

        if (res.rowsAffected) {
          const statementInfos = getStatementInfos(q);
          if (Array.isArray(res.rowsAffected) && res.rowsAffected.length > 1) {
              const details = res.rowsAffected.map((count: number, index: number) => {
                const info = statementInfos[index];
                if (info) {
                  return { Step: info.label, RowsAffected: count, Type: info.type };
                }
                let stepLabel = `Trigger / Internal (Seq ${index + 1})`;
                if (statementInfos.length === 1) {
                  stepLabel = `Trigger Execution (caused by ${statementInfos[0].type})`;
                }
                return {
                  Step: stepLabel, RowsAffected: count, Type: 'Trigger'
                };
              });
              return [details];
          }

          const val = Array.isArray(res.rowsAffected)
            ? res.rowsAffected[0]
            : res.rowsAffected;

          return [[{
            Status: 'Success',
            RowsAffected: val,
            Type: statementInfos[0]?.type || 'Statement',
            Target: statementInfos[0]?.label || 'Operation',
            Message: 'Query executed successfully.'
          }]];
      }

      if (res.recordsets && res.recordsets.length > 0) {
          return [res.recordsets[0]];
      }

      return [[{
        Status: 'Success',
        Message: 'Command executed successfully.'
      }]];
    },
    release() {
    },
  };
}

function getStatementInfos(sql: string): Array<{ type: string; label: string }> {
  const statements = splitSqlStatements(sql);
  return statements.map(s => getStatementInfo(s));
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
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

    if (!inSingle && !inDouble) {
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

    if (!inDouble && ch === "'") {
      if (inSingle && next === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === ';' && !inSingle && !inDouble) {
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

  // Regex mejorado para soportar [], "", `` y #temp tables (Universal)
  const namePat = "([#\\w.\\[\\]\"`]+)";

  const ddlMatch = cleaned.match(new RegExp(`\\b(CREATE|ALTER|DROP|TRUNCATE)\\s+TABLE\\s+${namePat}`, 'i'));
  if (ddlMatch) {
    const type = `${ddlMatch[1].toUpperCase()} TABLE`;
    const target = ddlMatch[2];
    return { type, label: `${type} ${target}` };
  }

  const insertMatch = cleaned.match(new RegExp(`\\bINSERT\\s+INTO\\s+${namePat}`, 'i'));
  if (insertMatch) {
    return { type: 'INSERT', label: `INSERT ${insertMatch[1]}` };
  }

  const updateMatch = cleaned.match(new RegExp(`\\bUPDATE\\s+${namePat}`, 'i'));
  if (updateMatch) {
    return { type: 'UPDATE', label: `UPDATE ${updateMatch[1]}` };
  }

  const deleteMatch = cleaned.match(new RegExp(`\\bDELETE\\s+FROM\\s+${namePat}`, 'i'));
  if (deleteMatch) {
    return { type: 'DELETE', label: `DELETE ${deleteMatch[1]}` };
  }

  const mergeMatch = cleaned.match(new RegExp(`\\bMERGE\\s+INTO\\s+${namePat}`, 'i'));
  if (mergeMatch) {
    return { type: 'MERGE', label: `MERGE ${mergeMatch[1]}` };
  }

  const execMatch = cleaned.match(new RegExp(`\\bEXEC(?:UTE)?\\s+${namePat}`, 'i'));
  if (execMatch) {
    return { type: 'EXEC', label: `EXEC ${execMatch[1]}` };
  }

  const selectMatch = cleaned.match(/\bSELECT\b/i);
  if (selectMatch) {
    return { type: 'SELECT', label: 'SELECT' };
  }

  const keywordMatch = cleaned.match(/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|SELECT)\b/i);
  if (keywordMatch) {
    const keyword = keywordMatch[1].toUpperCase();
    return { type: keyword, label: keyword };
  }

  return { type: 'Statement', label: 'Operation' };
}

interface TrinoConfig extends BaseConfig {
  driver: 'trino';
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
        const client = resolveTrinoClient(config, 'information_schema');
        const query = `SELECT table_schema, table_name, column_name
                      FROM columns
                      WHERE table_schema NOT IN ('information_schema', 'sys')`;

        const result = await runTrinoQuery(client, query);
        let rows: any[] = [];
        const tabular = result[0];
        if (tabular && typeof tabular === 'object' && 'rows' in tabular && Array.isArray((tabular as any).rows)) {
          rows = (tabular as any).rows;
        }

        const map = new Map<string, TableSchema>();
        rows.forEach((r: any) => {
          const key = `${r[0]}.${r[1]}`; // schema.table
          if (!map.has(key)) {
            map.set(key, { table: r[1], schema: r[0], columns: [] });
          }
          map.get(key)?.columns.push(r[2]);
        });
        return Array.from(map.values());
      } catch (e) {
        console.error('Error fetching trino schema', e);
        return [];
      }
    }
  };
}

function trinoConn(config: TrinoConfig): Conn {
  // 'client' vive en el closure de esta función
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
  const [catalog, dbSchema] = (config.database || '').split('/');
  const schema = schemaOverride || dbSchema || 'default';
  const host = config.host.startsWith('http') ? config.host : `http://${config.host}`;
  
  const opts = {
    server: `${host}:${config.port}`,
    catalog: catalog || 'tpch',
    schema: schema,
    // Usamos la clase BasicAuth que tus logs confirmaron
    auth: new trinoLib.BasicAuth(config.user, config.password || ''),
  };

  if (trinoLib.Trino && typeof trinoLib.Trino.create === 'function') {
    return trinoLib.Trino.create(opts);
  }
  throw new Error("No se pudo encontrar el constructor Trino o el método create en la librería.");
}

async function runTrinoQuery(client: any, q: string): Promise<ExecutionResult> {
  const rows: any[] = [];
  let columns: string[] = [];

  try {
    if (!client || typeof client.query !== 'function') {
      console.error('Trino client object:', client);
      throw new Error('Trino client does not have a query method. Check trino-client version and usage.');
    }
    const iterator = await client.query(q);
    if (!iterator || typeof iterator[Symbol.asyncIterator] !== 'function') {
      console.error('Trino query did not return an async iterator:', iterator);
      throw new Error('Trino client query did not return an async iterator.');
    }
    for await (const result of iterator) {
      if (!result) { continue; }
      if (result.error) {
        console.error('[Trino][ERROR]', result.error);
        // Devuelve el error como resultado para mostrarlo en el notebook
        return [[{
          Status: '❌ Error',
          Message: result.error.message || 'Unknown Trino error',
          ErrorCode: result.error.errorCode,
          ErrorName: result.error.errorName,
          ErrorType: result.error.errorType
        }]];
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