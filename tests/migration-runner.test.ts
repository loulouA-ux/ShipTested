import {test,expect,beforeAll,afterAll} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readMigrationStatements} from '../scripts/migration-statements';
const db=new PGlite();
// WASM database startup belongs to fixture setup, separate from the DDL timeout.
beforeAll(async()=>{await db.waitReady;});
afterAll(()=>db.close());
test('migration runner applies the complete schema twice including comments with semicolons',async()=>{
  const statements=readMigrationStatements(new URL('../migrations/',import.meta.url));
  for(let pass=0;pass<2;pass++)for(const sql of statements)await db.query(sql);
  const result=await db.query("select count(*)::int as count from information_schema.tables where table_name IN ('sc_batch_plans','sc_repair_merges')");
  expect(result.rows).toEqual([{count:2}]);
  const attempt=await db.query("select data_type,is_nullable from information_schema.columns where table_name='sc_repair_merges' AND column_name='attempt_id'");
  expect(attempt.rows).toEqual([{data_type:'uuid',is_nullable:'NO'}]);
});
