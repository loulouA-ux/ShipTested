/** Actual selected-repository App/OSV acceptance against local data only.
 * Preparing reads providers. Verification requires explicit run approval.
 * This script never publishes, merges, deploys, or configures billing.
 */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {assertLocalDatabase} from '../src/lib/server/local-database';
import {database} from '../src/lib/server/db';
import {listRepositories,repositorySnapshot,installationToken,type RepositorySnapshot} from '../src/lib/server/github-repositories';
import {scanRepository} from '../src/lib/server/repository-scan';
import {Store} from '../src/lib/server/store';
import {proposeRepositoryRepair,getRepair} from '../src/lib/server/repairs';
import {executeRepair,publishRepair,approvalHash} from '../src/lib/server/repair-execution';
import type {RepairPlan} from '../src/lib/repair/plan';
import type {RepairRun} from '../src/lib/repair/runner';
import {matchingDraft} from '../src/lib/server/matching-draft';
const directory=resolve('.private/provider-acceptance'),file=join(directory,'proposal.json');
const allowed=new Set(['chilu18/shipcheck-repair-fixture','chilu18/shiptested-fresh-judge-demo']);
try{
  assertLocalDatabase(process.env.DATABASE_URL||'');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const q=database();
  if(process.argv[2]==='prepare'){
    if(!/^github:[1-9][0-9]*$/.test(process.env.SHIPTESTED_ACCEPTANCE_ACTOR||''))throw Error('Set an existing admitted GitHub actor for provider acceptance.');
    const actor={id:process.env.SHIPTESTED_ACCEPTANCE_ACTOR!,workspaceId:process.env.SHIPTESTED_ACCEPTANCE_ACTOR!,role:'member' as const};
    const target=process.env.SHIPTESTED_ACCEPTANCE_REPOSITORY;
    if(!target||!allowed.has(target))throw Error('Only the existing synthetic acceptance repositories are permitted.');
    const repository=(await listRepositories(actor)).find(r=>r.full_name===target);
    if(!repository)throw Error('The selected synthetic repository is not in the existing App grant.');
    const snapshot=await repositorySnapshot(actor,repository.id);
    const report=await scanRepository({repository:target,commit:snapshot.commit,tree:snapshot.tree,private:repository.private,files:{'package-lock.json':snapshot.files['package-lock.json']},omitted:[]});
    await new Store(q).saveScan(actor,report);
    const dependency=report.findings.flatMap(f=>f.evidence).find(e=>e.dependency&&e.dependency.path===`package-lock.json:node_modules/${e.dependency.name}`)?.dependency;
    if(!dependency)throw Error('No supported direct npm advisory finding is available.');
    const proposal=await proposeRepositoryRepair(q,actor,repository.id,dependency.name,report.id);
    const evidence={preparedAt:new Date().toISOString(),actor,repository:target,repairId:proposal.id,reportId:report.id,planHash:proposal.plan.planHash,baseCommit:proposal.plan.baseCommit,from:proposal.plan.fromVersion,to:proposal.plan.toVersion,packageName:proposal.plan.packageName,sourceUrls:proposal.plan.sourceUrls};
    writeFileSync(file,JSON.stringify(evidence,null,2),{mode:0o600});
    writeFileSync(join(directory,'package.before.json'),proposal.plan.manifestBefore,{mode:0o600});
    writeFileSync(join(directory,'package.after.json'),proposal.plan.manifestAfter,{mode:0o600});
    console.log(JSON.stringify({...evidence,scope:'Actual App-authorized snapshot and OSV proposal persisted to local PostgreSQL. No cloud execution or GitHub content write.'},null,2));
  }else if(process.argv[2]==='approve-existing'){
    if(process.env.SHIPTESTED_ACCEPTANCE_PUBLICATION_APPROVED!=='1')throw Error('Explicit approval of the reviewed exact patch and existing draft handoff is required.');
    const proposal=JSON.parse(readFileSync(file,'utf8')),review=JSON.parse(readFileSync(join(directory,'review.json'),'utf8'));
    if(!allowed.has(proposal.repository)||!review.matchingDraft?.url)throw Error('No reviewed existing draft is available.');
    const row=await getRepair(q,proposal.actor,proposal.repairId);
    const result=await publishRepair(q,proposal.actor,proposal.repairId,approvalHash(row.plan as RepairPlan,row.result as RepairRun),fetch,review.matchingDraft.url);
    writeFileSync(join(directory,'handoff.json'),JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
  }else if(process.argv[2]==='review'){
    const proposal=JSON.parse(readFileSync(file,'utf8'));
    if(!allowed.has(proposal.repository))throw Error('Unexpected acceptance repository.');
    const row=await getRepair(q,proposal.actor,proposal.repairId),snapshot=row.snapshot as RepositorySnapshot,plan=row.plan as RepairPlan,result=row.result as RepairRun;
    if(row.state!=='verified'||!result?.lockfileAfter)throw Error('A verified repair is required for exact patch review.');
    const token=await installationToken(proposal.actor,snapshot.repository.id,false,fetch,true);
    const existing=await matchingDraft(snapshot,plan,result.lockfileAfter,token);
    writeFileSync(join(directory,'package-lock.before.json'),snapshot.files['package-lock.json'],{mode:0o600});
    const review={repository:proposal.repository,repairId:proposal.repairId,sourceCommit:plan.baseCommit,dependency:`${plan.packageName} ${plan.fromVersion} → ${plan.toVersion}`,baseline:result.baseline.map(c=>({command:c.command,exitCode:c.exitCode})),patched:result.patched.map(c=>({command:c.command,exitCode:c.exitCode})),artifactChecks:result.artifactChecks,cleanupComplete:result.cleanupComplete,advisoriesBefore:result.scans?.before.findings.length,advisoriesAfter:result.scans?.after?.findings.length,matchingDraft:existing?{url:existing.html_url,head:existing.head.sha}:null,scope:'Read-only exact-patch review; no approval, publication or GitHub content write.'};
    writeFileSync(join(directory,'review.json'),JSON.stringify(review,null,2),{mode:0o600});console.log(JSON.stringify(review,null,2));
  }else if(process.argv[2]==='verify'){
    if(process.env.SHIPTESTED_ACCEPTANCE_APPROVED!=='1')throw Error('Explicit approval for one bounded paid sandbox run is required.');
    const proposal=JSON.parse(readFileSync(file,'utf8'));
    if(!allowed.has(proposal.repository))throw Error('Unexpected acceptance repository.');
    const row=await getRepair(q,proposal.actor,proposal.repairId);
    const plan=row.plan as RepairPlan;
    if(row.state!=='proposed'||plan.planHash!==proposal.planHash||plan.baseCommit!==proposal.baseCommit)throw Error('Proposal changed or verification already started. No paid run was repeated.');
    process.env.SHIPTESTED_REPAIR_SANDBOX_ENABLED='true';
    process.env.SHIPTESTED_REPAIR_DAILY_RUNS='1';process.env.SHIPTESTED_REPAIR_TOTAL_RUNS='1';
    const result=await executeRepair(q,proposal.actor,proposal.repairId);
    writeFileSync(join(directory,'verification.json'),JSON.stringify(result,null,2),{mode:0o600});
    console.log(JSON.stringify({repairId:result.id,state:result.state,baseline:result.result.baseline.map(c=>({command:c.command,exitCode:c.exitCode})),patched:result.result.patched.map(c=>({command:c.command,exitCode:c.exitCode})),artifactChecks:result.result.artifactChecks,cleanupComplete:result.result.cleanupComplete,before:result.result.scans?.before.findings.length,after:result.result.scans?.after?.findings.length,errors:result.result.errors,publication:'Not requested. Exact patch review and separate approval still required.'},null,2));
    if(result.state!=='verified')process.exitCode=1;
  }else throw Error('Use prepare or verify. Publication is deliberately a separate human-reviewed action.');
}catch{console.error('Provider acceptance stopped. Review local configuration or saved evidence; no raw provider response, source or credential is logged.');process.exitCode=1;}
