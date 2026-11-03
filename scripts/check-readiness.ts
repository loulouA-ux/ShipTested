/** Read-only, sanitized readiness report. Does not migrate, mint tokens or run compute. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {brandEnv} from '../src/lib/brand-env';
import {database} from '../src/lib/server/db';
import {publicDemo} from '../src/lib/server/public-demo';
import {mergeEnabled} from '../src/lib/server/repair-merge';
const has=(name:string)=>Boolean(process.env[name]?.trim());
const report={checkedAt:new Date().toISOString(),scope:'Configuration presence; only --database performs read-only SQL. No provider authorization or deployment is inferred.',
  configuration:{demoOnly:publicDemo(),localPostgres:process.env.SHIPTESTED_LOCAL_POSTGRES==='1',database:has('DATABASE_URL'),identityOAuth:has('GITHUB_CLIENT_ID')&&has('GITHUB_CLIENT_SECRET'),repositoryApp:has('GITHUB_APP_ID')&&has('GITHUB_APP_PRIVATE_KEY'),customerRepositoryFlow:brandEnv('CUSTOMER_REPOSITORIES')==='1'&&has('GITHUB_APP_CLIENT_ID')&&has('GITHUB_APP_CLIENT_SECRET')&&has('SHIPTESTED_CONNECTION_ENCRYPTION_KEY'),scheduler:has('CRON_SECRET'),sandboxEnabled:brandEnv('REPAIR_SANDBOX_ENABLED')==='true',billingConfigured:has('STRIPE_SECRET_KEY')&&has('STRIPE_TEAM_PRICE_ID')&&has('STRIPE_WEBHOOK_SECRET')},
  merge:{enabled:mergeEnabled(),providerAcceptance:'Not established by configuration checks'},
  database:{attempted:false,reachable:false,requiredTablesPresent:false},
  externalGates:['Database provider lifetime/backups not verified','Continuous worker hosting not verified','GitHub account/install/revocation acceptance not verified','Sandbox budget/cleanup/provider authorization not verified','Stripe lifecycle and live activation not verified','Production revision and rollback not verified']};
if(process.argv.includes('--database')){
  report.database.attempted=true;
  try{
    const q=database();
    const rows=await q("SELECT to_regclass('sc_scan_jobs') IS NOT NULL AND to_regclass('sc_repairs') IS NOT NULL AND to_regclass('sc_repository_connections') IS NOT NULL AND to_regclass('sc_repository_installations') IS NOT NULL AND to_regclass('sc_repair_merges') IS NOT NULL AS ready");
    report.database.reachable=true;report.database.requiredTablesPresent=rows[0]?.ready===true;
  }catch{ /* No raw provider/database diagnostic is logged. */ }
}
mkdirSync('test-results/journey',{recursive:true});writeFileSync('test-results/journey/readiness.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.database.attempted&&!report.database.requiredTablesPresent)process.exitCode=1;
