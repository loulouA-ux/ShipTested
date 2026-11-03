import { expect,it } from 'vitest';
import { createHash } from 'node:crypto';
import { repositoryName,resolveRepository,fetchManifests } from '../src/lib/server/repository-manifests';
import { scanRepository } from '../src/lib/server/repository-scan';
const actor={id:'peter',workspaceId:'team',role:'member' as const};
const source={repository:'heysalad-ai/nicedeck',commit:'a'.repeat(40),tree:'b'.repeat(40),private:false};
function fixture(options:{corrupt?:boolean;truncated?:boolean;unsupported?:boolean}={}) {
  const content='pyserial==3.5\n';
  const hash=createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
  const fetcher=(async(url,init)=>{
    expect(String(url).startsWith('https://api.github.com/repos/heysalad-ai/nicedeck')).toBe(true);
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(init?.redirect).toBe('error');
    const p=new URL(String(url)).pathname;
    let data:unknown={full_name:source.repository,default_branch:'main',private:false};
    if(p.includes('/git/ref/heads/'))data={ref:'refs/heads/main',object:{type:'commit',sha:source.commit}};
    if(p.includes('/git/commits/'))data={sha:source.commit,tree:{sha:source.tree}};
    if(p.includes('/commits/')&&!p.includes('/git/'))return new Response('x'.repeat(1_000_001));
    if(p.includes('/trees/'))data={truncated:!!options.truncated,tree:[{path:'requirements.txt',sha:hash,type:'blob',mode:'100644',size:content.length},...(options.unsupported?[{path:'uv.lock',sha:hash,type:'blob',mode:'100644',size:content.length}]:[])]};
    if(p.includes('/blobs/'))data={encoding:'base64',content:Buffer.from(options.corrupt?'changed':content).toString('base64')};
    return Response.json(data);
  }) as typeof fetch;
  return fetcher;
}
it('normalises repository URLs and rejects alternate hosts or path tricks',()=>{
  expect(repositoryName('https://github.com/heysalad-ai/nicedeck.git')).toBe(source.repository);
  expect(repositoryName('heysalad-ai/.github')).toBe('heysalad-ai/.github');
  for(const bad of ['owner/..','owner/.','https://evil.example/owner/repo','https://github.com@evil.example/a/b','https://github.com/a/b?token=x','../repo','owner/repo/extra','https://github.com:8443/a/b'])expect(()=>repositoryName(bad)).toThrow();
});
it('pins public repositories without forwarding any token and verifies bytes',async()=>{
  const resolved=await resolveRepository(actor,'https://github.com/'+source.repository,false,fixture());
  expect(resolved).toEqual(source);
  expect((await fetchManifests(actor,resolved,fixture())).files).toEqual({'requirements.txt':'pyserial==3.5\n'});
});
it('rejects corrupted manifests and incomplete trees',async()=>{
  await expect(fetchManifests(actor,source,fixture({corrupt:true}))).rejects.toMatchObject({status:502});
  await expect(fetchManifests(actor,source,fixture({truncated:true}))).rejects.toMatchObject({status:422});
});
it('reports unsupported formats as omitted instead of claiming a clean repository',async()=>{
  const snapshot=await fetchManifests(actor,source,fixture({unsupported:true}));
  expect(snapshot.omitted).toEqual(['uv.lock']);
  const report=await scanRepository({...snapshot,files:{}});
  expect(report.status).toBe('Incomplete');
  expect(report.repositoryScan.commit).toBe(source.commit);
});
it('invalid manifest input does not become a clean scan',async()=>{
  const report=await scanRepository({...source,files:{'package-lock.json':'not json'},omitted:[]});
  expect(report.status).toBe('Incomplete');
  expect(report.repositoryScan.omitted).toEqual(['package-lock.json']);
});
it('accepts a bounded tree above 1 MB but still rejects more than 10000 entries',async()=>{
 const base=fixture();
 const tree=(n:number)=>({truncated:false,tree:Array.from({length:n},(_,i)=>({path:`src/${i}-`+'x'.repeat(200)+'.ts',type:'blob',mode:'100644',sha:'c'.repeat(40),size:1}))});
 const large=tree(4000);expect(JSON.stringify(large).length).toBeGreaterThan(1_000_000);
 const fetcher=(n:number)=>(async(url,init)=>String(url).includes('/git/trees/')?Response.json(n===4000?large:tree(n)):base(url,init)) as typeof fetch;
 expect((await fetchManifests(actor,source,fetcher(4000))).files).toEqual({});
 await expect(fetchManifests(actor,source,fetcher(10001))).rejects.toMatchObject({status:422});
});
it('rejects a compact commit that does not match the pinned tree',async()=>{
 const base=fixture();const f:typeof fetch=async(url,init)=>String(url).includes('/git/commits/')?Response.json({sha:source.commit,tree:{sha:'c'.repeat(40)}}):base(url,init);
 await expect(fetchManifests(actor,source,f)).rejects.toMatchObject({status:409});
});
