import {test,expect} from '@playwright/test';
test('interrupted verification recovery records failure without repeating paid execution',async({page})=>{
  const id='11111111-1111-4111-8111-111111111111',actions:string[]=[];
  let interrupted=false;
  const repair=()=>({id,canRecover:!interrupted,state:interrupted?'failed':'running',repository:{id:1,full_name:'team/synthetic'},plan:{packageName:'minimist',fromVersion:'1.2.5',toVersion:'1.2.6',baseCommit:'a'.repeat(40),manifestBefore:'{}',manifestAfter:'{}',sourceUrls:[],limitations:[]},auditTrail:[],...(interrupted?{result:{status:'incomplete',cleanupComplete:false,baseline:[],patched:[],errors:['Verification was interrupted. Inspect provider compute and cleanup before preparing a fresh proposal.']}}:{})});
  await page.route('**/api/session',route=>route.fulfill({json:{actor:{id:'operator'}}}));
  await page.route('**/api/repositories',route=>route.fulfill({json:{repositories:[]}}));
  await page.route('**/api/repairs',route=>route.fulfill({json:{repairs:[]}}));
  await page.route(`**/api/repairs/${id}`,route=>{
    if(route.request().method()==='POST'){actions.push(route.request().postDataJSON().action);interrupted=true;}
    return route.fulfill({json:repair()});
  });
  await page.goto(`/repairs/${id}`);
  await page.getByRole('button',{name:'Record interrupted verification'}).click();
  await expect(page.getByRole('region',{name:'Verification recovery'})).toContainText('Cleanup is unconfirmed');
  await expect(page.getByRole('button',{name:'Approve and create draft PR'})).toHaveCount(0);
  await page.reload();await expect(page.getByRole('region',{name:'Verification recovery'})).toBeVisible();
  expect(actions).toEqual(['recover']);
});
