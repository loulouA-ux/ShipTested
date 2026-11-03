import {database} from '../src/lib/server/db';
import {setTestCapacity} from '../src/lib/server/test-capacity';
async function main(){
 const [workspace,owner,limit,confirm]=process.argv.slice(2);
 const host=process.env.SHIPTESTED_WORKER_DB_HOST;
 if(confirm!=='--apply'||!host||new URL(process.env.DATABASE_URL??'').hostname!==host)throw Error('Explicit database host pin and --apply required.');
 console.log(JSON.stringify(await setTestCapacity(database(),workspace,owner,Number(limit))));
}
main().catch(()=>{console.error('Capacity unchanged or unconfirmed: check database pin, owner, workspace and 301–500 limit. No credentials logged.');process.exitCode=1;});
