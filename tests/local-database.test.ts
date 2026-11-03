import { describe, it, expect } from 'vitest';
import { assertLocalDatabase } from '../src/lib/server/local-database';
const env = { SHIPTESTED_LOCAL_POSTGRES: '1', SHIPTESTED_APP_ORIGIN: 'http://127.0.0.1:3157' };
const url = 'postgresql://operator@127.0.0.1:55437/shiptested_acceptance';
describe('local database isolation', () => {
  it('permits an explicitly selected loopback development database', () => expect(() => assertLocalDatabase(url, env)).not.toThrow());
  it.each([
    { ...env, VERCEL: '1' }, { ...env, VERCEL_ENV: 'preview' },
    { ...env, SHIPTESTED_LOCAL_POSTGRES: '0' },
    { ...env, SHIPTESTED_APP_ORIGIN: 'https://shiptested.com' },
    { ...env, SHIPTESTED_APP_ORIGIN: 'http://127.0.0.1:3157/other' },
  ])('rejects hosted or non-explicit configuration: %j', candidate => expect(() => assertLocalDatabase(url, candidate)).toThrow());
  it.each([
    'postgresql://operator@database.example/shiptested_acceptance',
    'postgresql://operator@127.0.0.1/customer_data',
    'postgresql://operator@127.0.0.1/shiptested_acceptance?host=remote.example',
  ])('rejects a remote or unrelated database: %s', target => expect(() => assertLocalDatabase(target, env)).toThrow());
});
