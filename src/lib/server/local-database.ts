import { Pool } from 'pg';
import type { Query } from './db';
import { retrySerializable } from './db';
import { brandEnv } from '../brand-env';

/** Explicit, loopback-only development transport. Hosted environments retain Neon. */
export function assertLocalDatabase(url: string, env: Record<string,string|undefined> = process.env) {
  const target = new URL(url);
  const origin = new URL(brandEnv('APP_ORIGIN', env) || '');
  if (env.VERCEL || env.VERCEL_ENV || env.SHIPTESTED_LOCAL_POSTGRES !== '1' ||
      !['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      target.search || !/^\/shiptested_[a-z0-9_]+$/.test(target.pathname)) {
    throw Error('Local PostgreSQL requires an explicit loopback app and shiptested_ development database; hosted use is forbidden.');
  }
}

const pools = new Map<string, Pool>();
export function localDatabase(url: string): Query {
  assertLocalDatabase(url);
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000, allowExitOnIdle: true });
    pool.on('error', () => console.error('Local PostgreSQL connection unavailable.'));
    pools.set(url, pool);
  }
  const connection = pool;
  return async (text, params = [], options = {}) => {
    if (!options.serializable) return (await connection.query(text, params)).rows;
    return retrySerializable(async () => {
      const client = await connection.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await client.query(text, params);
        await client.query('COMMIT');
        return result.rows;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    });
  };
}
