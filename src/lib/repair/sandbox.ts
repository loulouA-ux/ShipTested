import { brandEnv } from "../brand-env";
import { Sandbox } from "@vercel/sandbox";
import { randomUUID } from "node:crypto";
import { maskSecrets } from "../scanner";
import {sandboxCredentials} from './credentials';
import type { RepairSandbox, SandboxFactory } from "./runner";

export function validateSnapshot(files:Record<string,string>){
 const entries=Object.entries(files);let size=0;
 if(entries.length>300)throw Error("Snapshot exceeds 300 files.");
 for(const [path,value] of entries){
  if(!path||path.length>240||path.startsWith("/")||path.includes("\\")||path.split("/").some(p=>!p||p===".."||p===".")||/[\x00-\x1f]/.test(path))throw Error("Unsafe snapshot path.");
  if(path.split("/").some(p=>[".git","node_modules",".npmrc",".yarnrc",".ssh",".vercel",".private"].includes(p)||p.startsWith(".env"))||/\.(pem|key|p12)$/i.test(path))throw Error("Snapshot contains a credential/configuration or generated path.");
  size+=Buffer.byteLength(value);if(size>2_000_000)throw Error("Snapshot exceeds 2 MB.");
 }
}
export const sandboxCommands={
 install:["ci","--ignore-scripts","--no-audit","--no-fund"],
 lockfile:["install","--package-lock-only","--ignore-scripts","--no-audit","--no-fund"],
 test:["run","test","--ignore-scripts"],
 build:["run","build","--ignore-scripts"],
} as const;
export function vercelSandboxFactory():SandboxFactory{
 if(brandEnv("REPAIR_SANDBOX_ENABLED")!=="true")throw Error("Paid repair sandboxes are not enabled.");
 const credentials=sandboxCredentials();
 return async(phase)=>{
  const sandbox=await Sandbox.create({...credentials,name:`shipcheck-${phase}-${randomUUID()}`,persistent:false,timeout:180000,resources:{vcpus:1},ports:[],networkPolicy:"deny-all"});
  const cwd=`${sandbox.cwd}/project`;
  try { await sandbox.mkDir(cwd); } catch { await sandbox.delete({deleteOrphanSnapshots:true});throw Error("Sandbox setup failed."); }
  let stopped=false;
  const adapter:RepairSandbox={
   async writeFiles(files){validateSnapshot(files);await sandbox.writeFiles(Object.entries(files).map(([path,value])=>({path:`${cwd}/${path}`,content:Buffer.from(value)})));},
   async network(policy){await sandbox.update({networkPolicy:policy==="deny-all"?"deny-all":{allow:["registry.npmjs.org"]}});},
   async run(command){
    const args=[...sandboxCommands[command]];
    const cmd=await sandbox.runCommand({cmd:"npm",args,cwd,detached:true,env:{CI:"true",npm_config_ignore_scripts:"true",npm_config_registry:"https://registry.npmjs.org",npm_config_userconfig:"/dev/null"}});
    let output="";
    for await(const log of cmd.logs()){
     output+=log.data;
     if(Buffer.byteLength(output)>64000){await cmd.kill();throw Error("Sandbox command output exceeded limit.");}
    }
    const done=await cmd.wait();
    return {command:`npm ${args.join(" ")}`,exitCode:done.exitCode,output:maskSecrets(output)};
   },
   async readFile(path){
    const stream=await sandbox.readFile({path,cwd});if(!stream)throw Error("Sandbox dependency file missing.");
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of stream){const b=Buffer.from(chunk);size+=b.length;if(size>200000){throw Error("Sandbox dependency file exceeds limit.");}chunks.push(b);}
    return Buffer.concat(chunks).toString("utf8");
   },
   async stop(){if(!stopped){await sandbox.delete({deleteOrphanSnapshots:true});stopped=true;}},
  };
  return adapter;
 };
}
