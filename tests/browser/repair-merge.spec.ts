import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const id='22222222-2222-4222-8222-222222222222',head='a'.repeat(40),base='b'.repeat(40),hash='c'.repeat(64);
const repair={id,state:'published',repository:{id:1,full_name:'team/demo'},url:'https://github.com/team/demo/pull/1',plan:{baseCommit:base,packageName:'lodash',fromVersion:'4.17.20',toVersion:'4.17.21',manifestBefore:'{"dependencies":{"lodash":"4.17.20"}}',manifestAfter:'{"dependencies":{"lodash":"4.17.21"}}',sourceUrls:['https://osv.dev/vulnerability/GHSA-test'],limitations:['Synthetic browser evidence; no live merge is performed.']}};
const ready={enabled:true,ready:true,method:'squash',headSha:head,baseSha:base,targetBranch:'main',approvalHash:hash,reasons:[],checks:[{name:'CI',state:'success'}]};
const record={state:'pending',attempt_id:'33333333-3333-4333-8333-333333333333',approval_hash:hash,head_sha:head,base_sha:base,request_id:'44444444-4444-4444-8444-444444444444',merge_commit:null};
async function setup(page:Page,options:{blocked?:boolean;disabled?:boolean;uncertain?:boolean}={}){
 const actions:string[]=[];let saved:Record<string,unknown>|null=null,previews=0;
 const actor={id:'github:1',workspaceId:'github:1',role:'member'};
 await page.route('**/api/session',r=>r.fulfill({json:{actor,login:'fixture-reviewer'}}));
 await page.route('**/api/workspaces',r=>r.fulfill({json:{actor,workspaces:[{id:'github:1',name:'Synthetic review workspace',role:'owner'}]}}));
 await page.route('**/api/repositories',r=>r.fulfill({json:{repositories:[repair.repository]}}));
 await page.route('**/api/repairs',r=>r.fulfill({json:{repairs:[]}}));
 await page.route(`**/api/repairs/${id}`,r=>r.fulfill({json:repair}));
 await page.route(`**/api/repairs/${id}/merge*`,async r=>{
  const request=r.request(),statusOnly=new URL(request.url()).searchParams.get('status')==='1';
  if(request.method()==='GET'){
   if(statusOnly)return r.fulfill({json:{enabled:!options.disabled,ready:false,method:'squash',reasons:[],record:saved}});
   previews++;
   return r.fulfill({json:options.blocked?{...ready,ready:false,approvalHash:undefined,reasons:['Mark the draft ready for review on GitHub, then check again.','A GitHub check or status is pending, failed or unknown.']}:ready});
  }
  const body=request.postDataJSON();actions.push(body.action);
  if(body.action==='approve'){
   expect(body).toEqual({action:'approve',approvalHash:hash,confirmMerge:true});saved={...record,state:options.uncertain?'uncertain':'pending'};
   if(options.uncertain)return r.fulfill({status:502,json:{error:'Merge outcome is unconfirmed. Check merge status; the write will not be repeated.'}});
  }else saved={...record,state:'merged',merge_commit:'d'.repeat(40)};
  return r.fulfill({json:saved});
 });
 await page.goto(`/repairs/${id}`);
 const panel=page.getByRole('region',{name:'Merge verified repair'});await expect(panel).toBeVisible();
 return {panel,actions,previews:()=>previews};
}
test('separate exact-head merge approval survives pending reload and reconciles without replay',async({page})=>{
 const {panel,actions,previews}=await setup(page);
 await expect(panel.getByRole('button',{name:'Check merge readiness',exact:true})).toBeVisible();expect(previews()).toBe(0);expect(actions).toEqual([]);
 await panel.getByRole('button',{name:'Check merge readiness',exact:true}).click();
 const approve=panel.getByRole('button',{name:'Approve and squash merge',exact:true});await expect(approve).toBeDisabled();
 await expect(panel.getByText('This approval expires after five minutes and can be used once.',{exact:false})).toBeVisible();
 await expect(panel.getByText(head,{exact:true})).toBeVisible();await expect(panel.getByText('main',{exact:true})).toBeVisible();
 await panel.getByRole('checkbox').check();await approve.dblclick();
 await expect(panel.getByText('GitHub accepted the request and is processing it.',{exact:false})).toBeVisible();expect(actions).toEqual(['approve']);
 await page.reload();await expect(panel.getByRole('button',{name:'Check merge status',exact:true})).toBeVisible();expect(actions).toEqual(['approve']);
 await panel.getByRole('button',{name:'Check merge status',exact:true}).click();await expect(panel.getByRole('heading',{name:'Repair merged',exact:true})).toBeVisible();
 await expect(panel.getByText('Deployment status has not been checked.',{exact:false})).toBeVisible();expect(actions).toEqual(['approve','reconcile']);
});
test('uncertain response offers status reads and clears approval instead of retrying merge',async({page})=>{
 const {panel,actions}=await setup(page,{uncertain:true});
 await panel.getByRole('button',{name:'Check merge readiness',exact:true}).click();await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Approve and squash merge',exact:true}).click();
 await expect(panel.getByRole('alert')).toContainText('unconfirmed');await expect(panel.getByRole('button',{name:'Check merge status',exact:true})).toBeVisible();
 await expect(panel.getByRole('button',{name:'Approve and squash merge',exact:true})).toHaveCount(0);
 await panel.getByRole('button',{name:'Check merge status',exact:true}).click();await expect(panel.getByRole('heading',{name:'Repair merged',exact:true})).toBeVisible();expect(actions).toEqual(['approve','reconcile']);
});
test('draft and failing checks have actionable blockers and no merge approval',async({page})=>{
 const {panel,actions}=await setup(page,{blocked:true});await panel.getByRole('button',{name:'Check merge readiness',exact:true}).click();
 await expect(panel.getByText('Mark the draft ready for review on GitHub, then check again.',{exact:true})).toBeVisible();
 await expect(panel.getByRole('checkbox')).toHaveCount(0);await expect(panel.getByRole('button',{name:'Approve and squash merge',exact:true})).toHaveCount(0);expect(actions).toEqual([]);
});
test('disabled deployment shows the GitHub handoff without merge controls',async({page})=>{
 const {panel,actions}=await setup(page,{disabled:true});await expect(panel.getByText('Merging is not enabled here.',{exact:false})).toBeVisible();await expect(panel.getByRole('button')).toHaveCount(0);expect(actions).toEqual([]);
});
for(const theme of ['dark','light'])for(const width of [1280,390])test(`merge review is accessible at ${width}px in ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.addInitScript(theme=>localStorage.setItem('shipcheck-theme',theme),theme);
 const {panel,actions}=await setup(page);await panel.getByRole('button',{name:'Check merge readiness',exact:true}).click();
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 await expect(panel.getByRole('button',{name:'Approve and squash merge',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const scan=await new AxeBuilder({page}).include('[aria-label="Merge verified repair"]').analyze();expect(scan.violations).toEqual([]);
 await panel.screenshot({path:`test-results/merge/review-${theme}-${width}.png`});
 // Capture the full mobile document from the top so fixed navigation does not
 // obscure the consent label in a tall element-only capture.
 if(width===390){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`test-results/merge/review-${theme}-mobile-page.png`,fullPage:true});}
 expect(actions).toEqual([]);
});
