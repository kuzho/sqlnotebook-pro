import * as mysql from 'mysql2/promise';
import * as pg from 'pg';
import * as mssql from 'mssql';
import initSqlJs from 'sql.js';
import * as fs from 'fs/promises';
import type { Database as SqliteDatabase } from 'sql.js';
import * as path from 'path';
import * as vscode from 'vscode';

const supportedDrivers = ['mysql', 'postgres', 'mssql', 'sqlite'] as const;

export type DriverKey = typeof supportedDrivers[number];

export type TableSchema = {
  table: string;
  columns: string[];
};

export interface Pool {
  getConnection: () => Promise<Conn>;
  end: () => void;
  getSchema: () => Promise<TableSchema[]>;
}

export type ExecutionResult = TabularResult[];

export type TabularResult = Row[];

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
  | PostgresConfig;

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
      const result = [stm.getAsObject()];
      while (stm.step()) {
        result.push(stm.getAsObject());
      }
      stm.free();
      if (dbFile) {
        const data = conn.export();
        const buffer = Buffer.from(data);
        await fs.writeFile(dbFile, buffer);
      }

      return [result];
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
          SELECT TABLE_NAME, COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
        `) as any;

        const map = new Map<string, string[]>();
        rows.forEach((r: any) => {
          if (!map.has(r.TABLE_NAME)) map.set(r.TABLE_NAME, []);
          map.get(r.TABLE_NAME)?.push(r.COLUMN_NAME);
        });

        return Array.from(map.entries()).map(([table, columns]) => ({ table, columns }));
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
      })) as any;
      console.debug('mysql query result', { result, ok });

      if (!result.length) {
        return [[result]];
      }

      const hasMultipleResults =
        ok.length > 1 && ok.some((a: any) => a?.length);
      if (hasMultipleResults) {
        return result.map((res: any) =>
          res.length !== undefined ? res : [res]
        );
      }
      return [result];
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
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
        `);

        const map = new Map<string, string[]>();
        res.rows.forEach(r => {
          if (!map.has(r.table_name)) map.set(r.table_name, []);
          map.get(r.table_name)?.push(r.column_name);
        });
        return Array.from(map.entries()).map(([table, columns]) => ({ table, columns }));
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
      const response = (await conn.query(q)) as any as pg.QueryResult<any>[];
      console.debug('pg query response', { response });

      const maybeResponses = !!response.length
        ? response
        : ([response] as any as pg.QueryResult<any>[]);

      return maybeResponses.map(({ rows, rowCount }) => {
        if (!rows.length) {
          return rowCount !== null ? [{ rowCount: rowCount }] : [];
        }
        return rows;
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
  const conn = await mssql.connect({
    server: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    requestTimeout: config.queryTimeout,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
  });
  return mssqlPool(conn);
}

function mssqlPool(pool: mssql.ConnectionPool): Pool {
  return {
    async getConnection(): Promise<Conn> {
      const req = new mssql.Request();
      return mssqlConn(req);
    },
    end() {
      pool.close();
    },
    async getSchema(): Promise<TableSchema[]> {
      try {
        const res = await pool.query(`
          SELECT TABLE_NAME, COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
        `);

        const map = new Map<string, string[]>();
        res.recordset.forEach(r => {
          if (!map.has(r.TABLE_NAME)) map.set(r.TABLE_NAME, []);
          map.get(r.TABLE_NAME)?.push(r.COLUMN_NAME);
        });
        return Array.from(map.entries()).map(([table, columns]) => ({ table, columns }));
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
      const res = await req.query(q);
      if (res.recordsets.length < 1) {
        return [[{ rows_affected: `${res.rowsAffected}` }]];
      }
      return [res.recordsets[0]];
    },
    release() {
    },
  };
}