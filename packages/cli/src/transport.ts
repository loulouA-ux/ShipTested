import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
export class PreviewTransportError extends Error {
 constructor(public reason:'timeout'|'connection'|'invalid_response'|'command_failed',public retryable:boolean){super(`Protected preview transport failed (${reason}). Check Vercel access and connectivity; progress is saved.`);}
}
/** Vercel account authentication is transport-only; retain ShipTested bearer auth. */
export function hostedTransport(origin:string):typeof fetch {
 if(!process.env.SHIPTESTED_VERCEL_TRANSPORT)return fetch;
 if(process.env.SHIPTESTED_VERCEL_TRANSPORT!=='1'||origin!=='https://shipcheck-git-codex-hosted-workflow-hey-salad-inc.vercel.app')throw Error('Vercel transport is restricted to the approved protected preview.');
 return (async (input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.origin!==origin||!url.pathname.startsWith('/api/')||url.search||url.hash||url.username||url.password)throw Error('Invalid preview request.');
  const headers=new Headers(init?.headers),authorization=headers.get('authorization');
  if(!authorization||!/^Bearer st_[a-f0-9]{64}$/.test(authorization))throw Error('ShipTested authentication required.');
  const method=init?.method??'GET';if(!['GET','POST'].includes(method))throw Error('Unsupported preview method.');
  const directory=await mkdtemp(join(tmpdir(),'shiptested-transport-'));
  try{
   const config=join(directory,'request.conf');
   const lines=['silent','show-error','no-location','no-location-trusted','max-time = 45',`request = "${method}"`,'write-out = "\\nSTATUS:%{http_code}"',`header = ${JSON.stringify('Authorization: '+authorization)}`,'header = "Content-Type: application/json"'];
   if(init?.body!==undefined){if(typeof init.body!=='string')throw Error('Invalid request body.');lines.push(`data = ${JSON.stringify(init.body)}`);}
   await writeFile(config,lines.join('\n')+'\n',{mode:0o600});
   const {stdout}=await run('vercel',['curl',url.pathname,'--deployment',origin,'--scope','hey-salad-inc','--','--config',config],{timeout:55000,maxBuffer:2100000,signal:init?.signal??undefined});
   const marker=stdout.lastIndexOf('\nSTATUS:');
   const status=Number(stdout.slice(marker+8));if(marker<0||status<200||status>599)throw new PreviewTransportError('invalid_response',false);
   return new Response(stdout.slice(0,marker),{status});
  }catch(error){
   if(error instanceof PreviewTransportError)throw error;
   const e=error as {code?:unknown;stderr?:unknown};
   const stderr=typeof e?.stderr==='string'?e.stderr:'';
   const timeout=init?.signal?.reason?.name==='TimeoutError'||/curl: \(28\)/.test(stderr)||e?.code==='ETIMEDOUT';
   const connection=/curl: \((5|6|7|18|35|52|55|56)\)/.test(stderr);
   throw new PreviewTransportError(timeout?'timeout':connection?'connection':'command_failed',timeout||connection);
  }
  finally{await rm(directory,{recursive:true,force:true});}
 }) as typeof fetch;
}
