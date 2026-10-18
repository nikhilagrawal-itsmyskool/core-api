import { Pool, PoolClient } from 'pg';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { transformKeys } from '../util/case-transform';

const baseConfig = {
  host: process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT,
  database: process.env.POSTGRES_DATABASE,
  // In SSM mode (POSTGRES_SSM_PASSWORD_PARAM set) connect as the dedicated SSM
  // username; otherwise keep the existing default username untouched.
  user: process.env.POSTGRES_SSM_PASSWORD_PARAM
    ? process.env.POSTGRES_SSM_USERNAME
    : process.env.POSTGRES_USER || process.env.POSTGRES_USERNAME,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  ssl: process.env.POSTGRES_SSL === 'false' ? false : {
    rejectUnauthorized: false, // AWS RDS doesn't require certificate verification
  },
};

// When POSTGRES_SSM_PASSWORD_PARAM is set, the DB connects as POSTGRES_SSM_USERNAME
// with the password fetched from that SSM Parameter Store entry at runtime (cached
// with a short TTL). This lets the credential be rotated without redeploying. When
// it is not set, behaviour is identical to before: the default POSTGRES_USERNAME /
// POSTGRES_PASSWORD env vars are used unchanged.
const SSM_PARAM = process.env.POSTGRES_SSM_PASSWORD_PARAM;
const SSM_TTL_MS = 5 * 60 * 1000; // refetch rotated password after 5 min (auth-retry also recovers immediately)
const AUTH_FAILED = '28P01'; // postgres error code: invalid_password

let ssmClient: SSMClient | null = null;
let cachedPassword: { value: string; at: number } | null = null;
let poolPromise: Promise<Pool> | null = null;

async function fetchPassword(): Promise<string | undefined> {
  if (!SSM_PARAM) return process.env.POSTGRES_PASSWORD;
  if (cachedPassword && Date.now() - cachedPassword.at < SSM_TTL_MS) {
    return cachedPassword.value;
  }
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'ap-south-1' });
  }
  const res = await ssmClient.send(new GetParameterCommand({ Name: SSM_PARAM, WithDecryption: true }));
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${SSM_PARAM} returned no value`);
  cachedPassword = { value, at: Date.now() };
  return value;
}

async function buildPool(): Promise<Pool> {
  const password = await fetchPassword();
  const pool = new Pool({ ...baseConfig, password });
  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });
  return pool;
}

function getPool(): Promise<Pool> {
  if (!poolPromise) {
    poolPromise = buildPool();
  }
  return poolPromise;
}

// Drop the current pool and cached password so the next query rebuilds with a
// freshly fetched password (used after an auth failure, i.e. a rotated password).
async function resetPool(): Promise<void> {
  cachedPassword = null;
  const existing = poolPromise;
  poolPromise = null;
  if (existing) {
    try {
      const p = await existing;
      await p.end();
    } catch (err) {
      // ignore teardown errors on an already-broken pool
    }
  }
}

function isAuthError(err: any): boolean {
  return !!err && err.code === AUTH_FAILED;
}

// Acquire a client and run `op`. When using SSM-sourced credentials, a password
// auth failure (28P01) likely means the password was rotated: invalidate the
// cached password + pool and retry once so the new password is picked up without
// a redeploy. With a static env password, behaviour is a single attempt as before.
async function runWithRetry<T>(op: (client: PoolClient) => Promise<T>): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const pool = await getPool();
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const result = await op(client);
      client.release();
      return result;
    } catch (err) {
      if (client) {
        client.release(true); // destroy this client; creds/connection may be bad
      }
      lastErr = err;
      if (SSM_PARAM && isAuthError(err) && attempt === 0) {
        console.warn('DB auth failed (28P01); refetching password from SSM and retrying');
        await resetPool();
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

class Db {
  public query(str: string, queryParams?: any[]): Promise<any> {
    console.log('Querying for DB: ', str, queryParams, process.env.POSTGRES_ENDPOINT || process.env.POSTGRES_HOST, process.env.POSTGRES_DATABASE);
    return runWithRetry(async (client) => {
      const result = await client.query(str, queryParams);
      return transformKeys(result.rows);
    });
  }

  public queryWithResult(str: string, result: any, queryParams?: any[]): Promise<any> {
    console.log('Querying with result for DB : ', str, queryParams, process.env.POSTGRES_ENDPOINT || process.env.POSTGRES_HOST, process.env.POSTGRES_DATABASE);
    return runWithRetry(async (client) => {
      await client.query(str, queryParams);
      return result;
    });
  }

  public queriesInTransaction(queries: string[], queriesParams: any[][]): Promise<any[]> {
    return runWithRetry(async (client) => {
      try {
        await client.query('BEGIN');
        const results: any[] = [];
        for (let i = 0; i < queries.length; i++) {
          const result = await client.query(queries[i], queriesParams[i]);
          results.push(transformKeys(result.rows));
        }
        await client.query('COMMIT');
        return results;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { /* client may be dead */ }
        throw err;
      }
    });
  }

  public beginTransaction(): Promise<any> {
    console.log(`beginTransaction`);
    return this.query('BEGIN');
  }

  public commitTransaction(): Promise<any> {
    console.log(`commitTransaction`);
    return this.query('COMMIT');
  }

  public rollbackTransaction(): Promise<any> {
    console.log(`rollbackTransaction`);
    return this.query('ROLLBACK');
  }

  // Close the connection pool. Used by tests that import services directly so
  // Jest can exit cleanly (no-op in Lambda, where the pool is reused).
  public async end(): Promise<void> {
    if (poolPromise) {
      const existing = poolPromise;
      poolPromise = null;
      try {
        const p = await existing;
        await p.end();
      } catch (err) {
        // ignore
      }
    }
  }

  static singleLineString(strings: TemplateStringsArray, ...values: any[]): string {
    let output = '';
    for (let i = 0; i < values.length; i++) {
      output += strings[i] + values[i];
    }
    output += strings[values.length];
    const lines = output.split(/(?:\r\n|\n|\r)/);
    return lines
      .map((line) => {
        return line.replace(/^\s+/gm, '');
      })
      .join(' ')
      .trim();
  }
}

export const DB = new Db();
export const Query = DB.query;
export const singleLineString = Db.singleLineString;
