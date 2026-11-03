import {describe,it,expect,vi,beforeEach} from 'vitest';
import {matchingDraft,gitBlobHash} from '../src/lib/server/matching-draft';
import type {RepositorySnapshot} from '../src/lib/server/github-repositories';
import type {RepairPlan} from '../src/lib/repair/plan';
const network=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/server/github-repositories',()=>({githubRequest:network}));
const snapshot={repository:{id:1,full_name:'owner/demo',default_branch:'main'}} as RepositorySnapshot;
const plan={baseCommit:'a'.repeat(40),manifestAfter:'{"dependencies":{"minimist":"1.2.6"}}'} as RepairPlan;
const lock='{"lockfileVersion":3}';
const pr={number:2,html_url:'https://github.com/owner/demo/pull/2',state:'open',draft:true,merged_at:null,head:{sha:'b'.repeat(40),ref:'existing-repair',repo:{id:1}},base:{sha:plan.baseCommit,ref:'main',repo:{id:1}}};
const files=[{filename:'package.json',status:'modified',sha:gitBlobHash(plan.manifestAfter)},{filename:'package-lock.json',status:'modified',sha:gitBlobHash(lock)}];
beforeEach(()=>{network.mockReset();network.mockImplementation(async(path:string)=>path.includes('/files?')?files:path.includes('/pulls?')?[pr]:pr);});
describe('existing exact draft discovery',()=>{
  it('confirms the same two Git blobs and pinned base using reads only',async()=>{
    expect(await matchingDraft(snapshot,plan,lock,'synthetic')).toEqual(pr);
    expect(network.mock.calls.every(c=>!c[2]?.method||c[2].method==='GET')).toBe(true);
  });
  it.each([
    [...files,{filename:'test.cjs',status:'modified',sha:'c'.repeat(40)}],
    [files[0],{...files[1],sha:'c'.repeat(40)}],
    [files[0],{...files[1],status:'renamed'}],
  ].map(candidate=>({candidate})))('does not reuse a different patch',async ({candidate})=>{
    network.mockImplementation(async(path:string)=>path.includes('/files?')?candidate:[pr]);
    expect(await matchingDraft(snapshot,plan,lock,'synthetic')).toBeNull();
  });
  it('rejects multiple matching drafts instead of choosing one or writing another',async()=>{
    network.mockImplementation(async(path:string)=>path.includes('/files?')?files:[pr,{...pr,number:3,html_url:'https://github.com/owner/demo/pull/3'}]);
    await expect(matchingDraft(snapshot,plan,lock,'synthetic')).rejects.toMatchObject({status:409});
  });
  it('rejects a draft becoming ready during confirmation',async()=>{
    network.mockImplementation(async(path:string)=>path.includes('/files?')?files:path.includes('/pulls?')?[pr]:{...pr,draft:false});
    await expect(matchingDraft(snapshot,plan,lock,'synthetic')).rejects.toMatchObject({status:409});
  });
  it('does not reuse a different base or fork',async()=>{
    network.mockResolvedValue([{...pr,base:{...pr.base,sha:'c'.repeat(40)}},{...pr,head:{...pr.head,repo:{id:9}}}]);
    expect(await matchingDraft(snapshot,plan,lock,'synthetic')).toBeNull();expect(network).toHaveBeenCalledTimes(1);
  });
});
