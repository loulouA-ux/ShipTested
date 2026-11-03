import {createHash} from 'node:crypto';
import {z} from 'zod';
import {githubRequest,type RepositorySnapshot} from './github-repositories';
import {ApiError} from './http';
import type {RepairPlan} from '../repair/plan';
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const pull=z.object({number:z.number().int().positive(),html_url:z.string().url(),draft:z.boolean(),state:z.string(),merged_at:z.string().nullable().optional(),head:z.object({sha,ref:z.string(),repo:z.object({id:z.number()}).nullable()}),base:z.object({sha,ref:z.string(),repo:z.object({id:z.number()})})});
export function gitBlobHash(content:string){const bytes=Buffer.from(content);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');}
/** Reads only. Reuse requires identical two-file Git blobs and the verified base. */
export async function matchingDraft(snapshot:RepositorySnapshot,plan:RepairPlan,lockfile:string,token:string,fetcher:typeof fetch=fetch){
  const repo=snapshot.repository,base=`/repos/${repo.full_name}`;
  const pulls=z.array(pull).max(100).parse(await githubRequest(`${base}/pulls?state=open&base=${encodeURIComponent(repo.default_branch)}&per_page=100`,token,{},fetcher));
  if(pulls.length===100)throw new ApiError(409,'Open pull-request discovery is incomplete. Review existing drafts before publication.');
  const eligible=(p:z.infer<typeof pull>)=>p.state==='open'&&p.draft&&!p.merged_at&&p.head.repo?.id===repo.id&&p.base.repo.id===repo.id&&p.base.ref===repo.default_branch&&p.base.sha===plan.baseCommit&&p.html_url===`https://github.com/${repo.full_name}/pull/${p.number}`;
  const candidates=pulls.filter(eligible);
  if(candidates.length>10)throw new ApiError(409,'Too many candidate drafts. Review existing pull requests before publication.');
  const expected=new Map([['package.json',gitBlobHash(plan.manifestAfter)],['package-lock.json',gitBlobHash(lockfile)]]);
  const matches:z.infer<typeof pull>[]=[];
  for(const candidate of candidates){
    const files=z.array(z.object({filename:z.string(),sha,status:z.string()})).max(100).parse(await githubRequest(`${base}/pulls/${candidate.number}/files?per_page=100`,token,{},fetcher));
    if(files.length===2&&new Set(files.map(f=>f.filename)).size===2&&files.every(f=>f.status==='modified'&&expected.get(f.filename)===f.sha))matches.push(candidate);
  }
  if(matches.length>1)throw new ApiError(409,'Multiple existing drafts match this patch. Review them before publication.');
  if(!matches.length)return null;
  const confirmed=pull.parse(await githubRequest(`${base}/pulls/${matches[0].number}`,token,{},fetcher));
  if(!eligible(confirmed)||confirmed.head.sha!==matches[0].head.sha)throw new ApiError(409,'The existing draft changed during review. Reload before approving.');
  return confirmed;
}
