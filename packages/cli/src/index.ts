#!/usr/bin/env node
import {hostedTransport} from './transport.js';
import {open,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {spawn} from 'node:child_process';
import {scan,getAdvisory,maskSecrets} from '@heysalad/shiptested';
import {HostedClient} from '@heysalad/shiptested/hosted';
import {batchCommand,BatchHttpError,BatchTransportError} from './batch.js';
import {help,version} from './commands.js';
import {exitCode,sarif,type Threshold} from './output.js';
class UsageError extends Error {}
async function readInput(path:string){
 const file=await open(path,'r');
 try{const stat=await file.stat();if(!stat.isFile()||stat.size>2_000_000)throw new UsageError('Input must be a regular file of at most 2 MB.');
 const buffer=Buffer.alloc(2_000_001);let size=0;
 while(size<buffer.length){const {bytesRead}=await file.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
 if(size>2_000_000)throw new UsageError('Input exceeds 2 MB.');return buffer.subarray(0,size).toString('utf8');
 }finally{await file.close();}
}
async function main(args:string[]):Promise<number>{
 if(args.length===0||args[0]==='--help'){process.stdout.write(help());return 0;}
 if(args[0]==='--version'){process.stdout.write(version+'\n');return 0;}
 const [command,...rest]=args;
 if(command==='batch'){
  try{process.stdout.write(JSON.stringify(await batchCommand(rest),null,2)+'\n');return 0;}
  catch(error){if(error instanceof BatchHttpError||error instanceof BatchTransportError)throw new UsageError(error.message);throw new UsageError('Batch stopped. Check input, plan lock, credentials, service access and allowance. Progress is saved; resume with the same plan, never recreate it after submission.');}
 }
 if(['repo','job','report','usage'].includes(command)){
  if(!process.env.SHIPTESTED_API_ORIGIN||!process.env.SHIPTESTED_API_TOKEN)throw new UsageError('Configure SHIPTESTED_API_ORIGIN and SHIPTESTED_API_TOKEN privately for managed scans.');
  const client=new HostedClient(process.env.SHIPTESTED_API_ORIGIN,process.env.SHIPTESTED_API_TOKEN,hostedTransport(process.env.SHIPTESTED_API_ORIGIN));
  let result;
  try {
   if(command==='repo'){
    if(!rest[0]||rest[0].startsWith('--'))throw new UsageError('Usage: repo <GitHub URL> [--private] [--request-key UUID]');
    let privateAccess=false,requestKey:string|undefined;
    for(let i=1;i<rest.length;i++){
     if(rest[i]==='--private'&&!privateAccess)privateAccess=true;
     else if(rest[i]==='--request-key'&&requestKey===undefined){
      requestKey=rest[++i];
      if(!requestKey||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestKey))throw new UsageError('--request-key requires a UUID.');
     }else throw new UsageError('Usage: repo <GitHub URL> [--private] [--request-key UUID]');
    }
    requestKey??=crypto.randomUUID();
    process.stderr.write(`Request key: ${requestKey}. Reuse with --request-key when retrying this submission.\n`);
    result=await client.scanRepository(rest[0],privateAccess,requestKey);
   }else if(command==='usage'){if(rest.length)throw new UsageError('usage accepts no arguments.');result=await client.usage();}
   else {if(rest.length!==1)throw new UsageError(`${command} requires one ID.`);result=command==='job'?await client.job(rest[0]):await client.report(rest[0]);}
  }catch(error){if(error instanceof UsageError)throw error;throw new UsageError('Managed request failed. Check your token, allowance, IDs and configured API origin.');}
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return 0;
 }
 if(command==='mcp'){
  if(rest.length)throw new UsageError('mcp accepts no arguments.');
  return new Promise(resolve=>{const child=spawn('shiptested-mcp',[],{stdio:'inherit',shell:false});child.on('error',()=>{process.stderr.write('Install @heysalad/shiptested-mcp alongside the CLI.\n');resolve(64);});child.on('exit',code=>resolve(code??70));});
 }
 if(command==='explain'){
  if(rest.length!==1||!rest[0]||rest[0].startsWith('-'))throw new UsageError('explain requires one advisory ID.');
  const result=await getAdvisory(rest[0]);process.stdout.write(JSON.stringify({...result,source:`https://osv.dev/vulnerability/${rest[0]}`},null,2)+'\n');return 0;
 }
 if(command!=='scan')throw new UsageError('Unknown command. Use --help.');
 let path='package-lock.json',hasPath=false,json=false,quiet=false,ai=false,sarifPath:string|undefined,threshold:Threshold='high';
 for(let i=0;i<rest.length;i++){
  const arg=rest[i];
  if(arg==='--json')json=true;else if(arg==='--quiet')quiet=true;else if(arg==='--ai')ai=true;else if(arg==='--no-color')continue;
  else if(arg==='--sarif'){sarifPath=rest[++i];if(!sarifPath||sarifPath.startsWith('-'))throw new UsageError('--sarif needs a file.');}
  else if(arg==='--fail-on'){const value=rest[++i];if(!['high','medium','low','any'].includes(value))throw new UsageError('Invalid --fail-on threshold.');threshold=value as Threshold;}
  else if(arg.startsWith('-')||hasPath)throw new UsageError('Unexpected argument. Use --help.');else {path=arg;hasPath=true;}
 }
 if(ai&&!process.env.NEBIUS_API_KEY&&!process.env.TAVILY_API_KEY)throw new UsageError('--ai requires your own NEBIUS_API_KEY or TAVILY_API_KEY.');
 let content:string;try{content=await readInput(path);}catch{throw new UsageError('Cannot read input: supply a regular lockfile no larger than 2 MB.');}
 let report;
 try{report=await scan({lockfile:content,filename:basename(path)},{onStage:e=>{if(!quiet&&!json)process.stderr.write(`${e.status==='done'?'✓':e.status==='failed'?'!':'·'} ${e.stage} · ${e.detail} · ${(e.durationMs/1000).toFixed(1)}s\n`);}});}catch{throw new UsageError('Invalid or unsupported lockfile.');}
 if(ai){const {addNotes}=await import('@heysalad/shiptested/ai');report=await addNotes(report,{nebius:process.env.NEBIUS_API_KEY,tavily:process.env.TAVILY_API_KEY});}
 if(sarifPath)await writeFile(sarifPath,maskSecrets(JSON.stringify(sarif(report),null,2))+'\n',{flag:'wx',mode:0o600});
 if(json)process.stdout.write(JSON.stringify(report,null,2)+'\n');
 else if(!quiet)process.stdout.write(`${report.status.toUpperCase()} · ${report.dependencies.length} packages · ${report.findings.length} findings\n${report.findings.map(f=>`${f.severity.toUpperCase()} ${f.title}${f.fixedVersion?` · published fix → ${f.fixedVersion}`:''}`).join('\n')}\nUse --json for the evidence report.\n`);
 return exitCode(report,threshold);
}
main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(error instanceof UsageError?error.message+'\n':'Operation failed. No input or provider credentials were logged.\n');process.exitCode=error instanceof UsageError?64:70;});
