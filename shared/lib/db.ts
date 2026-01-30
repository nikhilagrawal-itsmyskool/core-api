import { Pool, QueryResult } from 'pg';
import { transformKeys } from '../util/case-transform';

const config = {
  host: process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT,
  database: process.env.POSTGRES_DATABASE,
  user: process.env.POSTGRES_USER || process.env.POSTGRES_USERNAME,
  password: process.env.POSTGRES_PASSWORD,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  ssl: process.env.POSTGRES_SSL === 'false' ? false : {
    rejectUnauthorized: false, // AWS RDS doesn't require certificate verification
  },
};

const pool = new Pool(config);

class Db {
  constructor() {
    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  public query(str: string, queryParams?: any[]): Promise<any> {
    console.log('Querying for DB: ', str, queryParams, process.env.POSTGRES_ENDPOINT || process.env.POSTGRES_HOST, process.env.POSTGRES_DATABASE);
    return new Promise<any>(async (resolve, reject) => {
      const client = await pool.connect();
      try {
        const result = await client.query(str, queryParams);
        resolve(transformKeys(result.rows));
      } catch (err) {
        console.error('SQL Error occurred: ', JSON.stringify(err));
        reject(err);
      } finally {
        client.release();
      }
    });
  }

  public queryWithResult(str: string, result: any, queryParams?: any[]): Promise<any> {
    console.log('Querying with result for DB : ', str, queryParams, process.env.POSTGRES_ENDPOINT || process.env.POSTGRES_HOST, process.env.POSTGRES_DATABASE);
    return new Promise<any>(async (resolve, reject) => {
      const client = await pool.connect();
      try {
        await client.query(str, queryParams);
        resolve(result);
      } catch (err) {
        console.error('SQL Error occurred: ', JSON.stringify(err));
        reject(err);
      } finally {
        client.release();
      }
    });
  }

  public queriesInTransaction(queries: string[], queriesParams: any[][]): Promise<any[]> {
    return new Promise<any>(async (resolve, reject) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results: any[] = [];
        for (let i = 0; i < queries.length; i++) {
          const result = await client.query(queries[i], queriesParams[i]);
          results.push(transformKeys(result.rows));
        }
        await client.query('COMMIT');
        resolve(results);
      } catch (err) {
        await client.query('ROLLBACK');
        reject(err);
      } finally {
        client.release();
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

