/** Disposable loopback runtime. Never loads a hosted environment or contacts billing. */
import {execFileSync,spawn} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {Client} from 'pg';
import {assertLocalDatabase} from '../src/lib/server/local-database';
const directory=resolve('.private/local-runtime'),config=join(directory,'runtime.env');
const port=55437,origin='http://127.0.0.1:3157';
function binaries(){return process.env.POSTGRES_BIN||execFileSync('pg_config',['--bindir'],{encoding:'utf8'}).trim();}
function pg(command:string,args:string[]){return execFileSync(join(binaries(),command),args,{stdio:'pipe'});}
function load(){
  if(process.env.VERCEL||process.env.VERCEL_ENV)throw Error('Local runtime is forbidden on hosted environments.');
  const env=parseEnv(readFileSync(config,'utf8'));
  if(!env.DATABASE_URL)throw Error('Local database configuration is missing.');
  assertLocalDatabase(env.DATABASE_URL,env);Object.assign(process.env,env);return {...env,DATABASE_URL:env.DATABASE_URL};
}
async function setup(){
  if(process.env.VERCEL||process.env.VERCEL_ENV)throw Error('Local runtime is forbidden on hosted environments.');
  const ciPostgres=process.env.CI==='true'&&process.env.SHIPTESTED_CI_POSTGRES==='1';
  mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
  if(!existsSync(config)){
    const password=ciPostgres?process.env.SHIPTESTED_CI_POSTGRES_PASSWORD:randomBytes(24).toString('hex'),key=()=>`sc_${randomBytes(32).toString('hex')}`;
    if(!password)throw Error('Disposable CI PostgreSQL credentials are missing.');
    const first=key(),second=key(),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
    const values={DATABASE_URL:`postgresql://shiptested_local:${password}@127.0.0.1:${port}/shiptested_local`,SHIPTESTED_LOCAL_POSTGRES:'1',SHIPTESTED_APP_ORIGIN:origin,SHIPTESTED_PUBLIC_DEMO:'0',SHIPTESTED_PETER_KEY_HASH:hash(first),SHIPTESTED_LOUISE_KEY_HASH:hash(second),SHIPTESTED_REPAIR_SANDBOX_ENABLED:'false',SHIPTESTED_CUSTOMER_REPOSITORIES:'0',SHIPTESTED_OPEN_REGISTRATION:'0',NEXT_PUBLIC_SITE_URL:origin};
    writeFileSync(config,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
    writeFileSync(join(directory,'access.json'),JSON.stringify({scope:'Local synthetic operator accounts only; no GitHub authorization',first,second},null,2),{mode:0o600});
    writeFileSync(join(directory,'postgres-password'),password,{mode:0o600});
  }
  const env=load(),data=join(directory,'postgres');
  if(!ciPostgres){
    if(!existsSync(join(data,'PG_VERSION')))pg('initdb',['-D',data,'-U','shiptested_local','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',join(directory,'postgres-password'),'--no-locale']);
    try{pg('pg_ctl',['-D',data,'status']);}catch{pg('pg_ctl',['-D',data,'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ''`,'-w','start']);}
  }
  const url=new URL(env.DATABASE_URL);url.pathname='/postgres';
  const admin=new Client({connectionString:url.toString()});await admin.connect();
  try{if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='shiptested_local'")).rowCount)await admin.query('CREATE DATABASE shiptested_local');}finally{await admin.end();}
  const client=new Client({connectionString:env.DATABASE_URL});await client.connect();
  try{
    await client.query('BEGIN');
    for(const file of readdirSync('migrations').filter(f=>/^\d+_[a-z_]+\.sql$/.test(f)).sort())await client.query(readFileSync(join('migrations',file),'utf8'));
    await client.query("INSERT INTO sc_workspaces(id,owner_id,name,plan,seat_limit,seats_used) VALUES('shipcheck-team','peter','Local acceptance workspace','team',2,2) ON CONFLICT DO NOTHING");
    await client.query("INSERT INTO sc_workspace_members(workspace_id,actor_id,role) VALUES('shipcheck-team','peter','owner'),('shipcheck-team','louise','member') ON CONFLICT DO NOTHING");
    await client.query("INSERT INTO sc_scan_allowances(workspace_id,period_start,scan_limit,reserved) VALUES('shipcheck-team',(date_trunc('month',now() AT TIME ZONE 'UTC'))::date,20,0) ON CONFLICT DO NOTHING");
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
  console.log('Local PostgreSQL and migrations ready. Access keys are in .private/local-runtime/access.json; do not share them.');
}
async function serve(){
  const env=load();
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3157'],{env:{...process.env,...env},stdio:'inherit'});
  const controller=new AbortController();
  const stop=()=>{controller.abort();child.kill('SIGTERM');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);child.once('exit',()=>controller.abort());
  const {database}=await import('../src/lib/server/db');
  const {runRepositoryJob}=await import('../src/lib/server/repository-worker');
  const {workerLoop}=await import('../src/lib/server/worker-loop');
  console.log(`Local app: ${origin}. Sequential scan worker enabled; billing and paid repair compute remain disabled.`);
  await workerLoop({signal:controller.signal,deadline:Date.now()+24*3600000,intervalMs:1000,maxCycles:86400,
    run:async()=>{const result=await runRepositoryJob(database());if(result.processed)console.log(JSON.stringify(result));},
    onError:()=>console.error('Local scan worker failed; saved jobs remain in PostgreSQL.')});
  stop();
}
try{
  if(process.argv[2]==='setup')await setup();
  else if(process.argv[2]==='serve')await serve();
  else if(process.argv[2]==='stop'){load();pg('pg_ctl',['-D',join(directory,'postgres'),'-w','stop']);console.log('Local PostgreSQL stopped. Saved local data retained.');}
  else throw Error('Use setup, serve or stop.');
}catch(error){console.error(error instanceof Error?error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[database URL masked]'):'Local runtime failed.');process.exitCode=1;}
