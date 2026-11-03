/** Negative HTTP acceptance against the isolated local runtime; no GitHub writes. */
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {strict as assert} from 'node:assert';
if(process.env.SHIPTESTED_LOCAL_POSTGRES!=='1'||process.env.SHIPTESTED_MERGE_ENABLED==='1')throw Error('Use the local runtime with merging disabled.');
const origin='http://127.0.0.1:3157',id='254cabe1-d3a8-40bb-8ced-f6608b3b636c',path=`/api/repairs/${id}/merge`;
const results:{check:string;status:number}[]=[];
async function check(name:string,path:string,expected:number,options:RequestInit={}){
 const r=await fetch(origin+path,{...options,redirect:'error'});assert.equal(r.status,expected,name);results.push({check:name,status:r.status});return r;
}
await check('Unauthenticated readiness denied',path,401);
await check('Malformed repair ID denied','/api/repairs/invalid/merge',400);
await check('Cross-origin approval denied',path,403,{method:'POST',headers:{Origin:'https://other.invalid','Content-Type':'application/json'},body:JSON.stringify({action:'approve',confirmMerge:true,approvalHash:'a'.repeat(64)})});
const access=JSON.parse(readFileSync('.private/local-runtime/access.json','utf8'));
const signed=await fetch(origin+'/api/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({key:access.first}),redirect:'error'});assert.equal(signed.status,200);
const cookie=signed.headers.get('set-cookie')?.split(';')[0];assert(cookie);
await check('Another owner readiness denied',path,404,{headers:{Cookie:cookie}});
await check('Another owner saved merge denied',path+'?status=1',404,{headers:{Cookie:cookie}});
await check('Missing explicit merge approval denied',path,400,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'approve',approvalHash:'a'.repeat(64)})});
await check('Disabled merge submission denied',path,403,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'approve',confirmMerge:true,approvalHash:'a'.repeat(64)})});
await check('Another owner reconciliation denied',path,404,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'reconcile'})});
await fetch(origin+'/api/session',{method:'DELETE',headers:{Origin:origin,Cookie:cookie}});
mkdirSync('test-results/merge',{recursive:true});const evidence={checkedAt:new Date().toISOString(),scope:'Real local HTTP, PostgreSQL and operator session; expected denials only. No GitHub merge or customer App authorization acceptance.',results};writeFileSync('test-results/merge/http-boundaries.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
