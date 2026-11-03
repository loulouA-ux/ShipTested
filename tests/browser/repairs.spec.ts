import {test,expect} from "@playwright/test";
const base={id:"11111111-1111-4111-8111-111111111111",state:"proposed",repository:{id:1,full_name:"team/demo"},plan:{baseCommit:"a".repeat(40),packageName:"lodash",fromVersion:"4.17.20",toVersion:"4.17.21",manifestBefore:'{"dependencies":{"lodash":"4.17.20"}}',manifestAfter:'{"dependencies":{"lodash":"4.17.21"}}',sourceUrls:["https://osv.dev/vulnerability/GHSA-test"],limitations:["Tests are required before approval."]}};
test("repair flow requires evidence review and explicit approval before PR request",async({page})=>{
 let state:Record<string,unknown>={...base},writes=0;
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[base.repository]}}));
 await page.route("**/api/repairs",r=>r.fulfill(r.request().method()==="GET"?{json:{repairs:[]}}:{json:state,status:201}));
 await page.route(`**/api/repairs/${base.id}`,async r=>{
  if(r.request().method()==="POST"){
   const b=r.request().postDataJSON();
   if(b.action==="verify")state={...base,state:"verified",approvalHash:"b".repeat(64),result:{scans:{before:{checkedAt:"2026-10-25T21:00:00Z",dependencyCount:1,lockfileHash:"c".repeat(64),findings:[{id:"GHSA-test:lodash",description:"OSV reports lodash@4.17.20 as affected.",evidence:[{dependency:{name:"lodash",version:"4.17.20",path:"node_modules/lodash"},url:"https://osv.dev/vulnerability/GHSA-test"}]}]},after:{checkedAt:"2026-10-25T21:01:00Z",dependencyCount:1,lockfileHash:"d".repeat(64),findings:[]}},status:"passed",cleanupComplete:true,baseline:[{command:"npm run test",exitCode:0,output:"1 test passed"}],patched:[{command:"npm run test",exitCode:0,output:"1 test passed"}],errors:[],lockfileAfter:'{"lockfileVersion":3}'}};
   if(b.action==="approve"){expect(b.approvalHash).toBe("b".repeat(64));writes++;state={...state,state:"published",url:"https://github.com/team/demo/pull/1"};}
  }
  await r.fulfill({json:state});
 });
 await page.goto("/repairs");await page.getByLabel("GitHub repository").selectOption("1");await page.getByLabel("Dependency package name").fill("lodash");await page.getByRole("button",{name:"Propose repair",exact:true}).click();
 await expect(page.getByText("4.17.20 → 4.17.21",{exact:false})).toBeVisible();
 await page.getByRole("button",{name:"Run isolated verification"}).click();
 await expect(page.getByRole("heading",{name:"Approve this exact patch",exact:true})).toBeVisible();
 await expect(page.getByText("OSV reports lodash@4.17.20 as affected.")).toBeVisible();
 await expect(page.getByText("1 resolved dependency checked · 0 advisory findings",{exact:false})).toBeVisible();
 const approve=page.getByRole("button",{name:"Approve and create draft PR"});await expect(approve).toBeDisabled();expect(writes).toBe(0);
 await page.getByLabel("I reviewed the diff and the test evidence",{exact:false}).check();await expect(approve).toBeEnabled();
 await page.screenshot({path:"test-results/repair-review-desktop.png",fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await approve.scrollIntoViewIfNeeded();
 await page.screenshot({path:".private/repair-approval-mobile.png"});
 await approve.click();await expect(page.getByRole("link",{name:"Open pull request"})).toHaveAttribute("href","https://github.com/team/demo/pull/1");expect(writes).toBe(1);
});
test("unconnected member sees actionable error without approving repairs",async({page})=>{
 await page.route("**/api/repairs",r=>r.fulfill({json:{repairs:[]}}));
 await page.route("**/api/repositories",r=>r.fulfill({status:403,json:{error:"No repository installation is connected to this account."}}));
 await page.goto("/repairs");await expect(page.getByRole("alert").filter({hasText:"No repository installation"})).toContainText("No repository installation");await expect(page.getByRole("button",{name:"Propose repair",exact:true})).toBeDisabled();
});
test("GitHub sign-in UI retains the existing key path",async({page})=>{
 await page.goto("/sign-in");await expect(page.getByRole("link",{name:"Continue with GitHub"})).toHaveAttribute("href","/api/auth/github/start");await expect(page.getByLabel("Individual access key")).toBeVisible();
});

test("reopens saved evidence after reload without repeating mutations",async({page})=>{
 let writes=0;
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[base.repository]}}));
 await page.route("**/api/repairs",r=>r.fulfill({json:{repairs:[{id:base.id,state:"published",package_name:"lodash",repository_name:"team/demo",created_at:"2026-10-25T21:00:00Z"}]}}));
 await page.route(`**/api/repairs/${base.id}`,r=>{if(r.request().method()!=="GET")writes++;return r.fulfill({json:{...base,state:"published",url:"https://github.com/team/demo/pull/1"}});});
 await page.goto("/repairs");await page.reload();
 await page.getByRole("button",{name:"team/demo · lodash · Draft PR created"}).click();
 await expect(page.getByRole("link",{name:"Open pull request"})).toHaveAttribute("href","https://github.com/team/demo/pull/1");
 expect(writes).toBe(0);
});

test("uncertain publication offers reconciliation rather than repeating approval",async({page})=>{
 const actions:string[]=[];
 let state:Record<string,unknown>={...base,state:"publishing"};
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[base.repository]}}));
 await page.route("**/api/repairs",r=>r.fulfill({json:{repairs:[{id:base.id,state:"publishing",package_name:"lodash",repository_name:"team/demo",created_at:"2026-10-25T21:00:00Z"}]}}));
 await page.route(`**/api/repairs/${base.id}`,r=>{
  if(r.request().method()==="POST"){actions.push(r.request().postDataJSON().action);state={...state,state:"published",url:"https://github.com/team/demo/pull/2"};}
  return r.fulfill({json:state});
 });
 await page.goto("/repairs");await page.getByRole("button",{name:"team/demo · lodash · Publication needs reconciliation"}).click();
 await expect(page.getByRole("button",{name:"Approve and create draft PR"})).toHaveCount(0);
 await page.getByRole("button",{name:"Check existing draft PR"}).click();
 await expect(page.getByRole("link",{name:"Open pull request"})).toHaveAttribute("href","https://github.com/team/demo/pull/2");
 expect(actions).toEqual(["reconcile"]);
});

test("audit history shows actor and evidence and exports without a mutation",async({page})=>{
 let writes=0;
 const events=[{id:"event-1",event_type:"patch_approved",actor_id:"github:123",created_at:"2026-10-25T21:00:00Z",details:{approvalHash:"a".repeat(64)}}];
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[base.repository]}}));
 await page.route("**/api/repairs",r=>r.fulfill({json:{repairs:[{id:base.id,state:"published",package_name:"lodash",repository_name:"team/demo",created_at:"2026-10-25T21:00:00Z"}]}}));
 await page.route(`**/api/repairs/${base.id}`,r=>{if(r.request().method()!=="GET")writes++;return r.fulfill({json:{...base,state:"published",auditTrail:events}});});
 await page.goto("/repairs");await page.getByRole("button",{name:"team/demo · lodash · Draft PR created"}).click();
 const audit=page.getByRole("region",{name:"Repair audit trail"});await expect(audit.getByText("Exact patch approved",{exact:true})).toBeVisible();await expect(audit.getByText("github:123",{exact:true})).toBeVisible();
 await audit.getByText("Evidence references",{exact:true}).click();await expect(audit.getByText(/approvalHash/)).toBeVisible();
 const download=page.waitForEvent("download");await audit.getByRole("button",{name:"Export audit trail"}).click();const file=await download;
 const {readFile}=await import("node:fs/promises");const exported=JSON.parse(await readFile((await file.path())!,"utf8"));expect(exported.repairId).toBe(base.id);expect(exported.events).toEqual(events);expect(writes).toBe(0);
 await page.screenshot({path:"test-results/repair-audit.png",fullPage:true});
});
