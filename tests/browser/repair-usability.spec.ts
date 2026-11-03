import {test,expect} from "@playwright/test";
const id="11111111-1111-4111-8111-111111111111";
const repair={id,state:"failed",repository:{id:1,full_name:"team/demo"},plan:{baseCommit:"a".repeat(40),packageName:"lodash",fromVersion:"4.17.20",toVersion:"4.17.21",manifestBefore:'{"dependencies":{"lodash":"4.17.20"}}',manifestAfter:'{"dependencies":{"lodash":"4.17.21"}}',sourceUrls:["https://osv.dev/vulnerability/GHSA-test"],limitations:["Tests are required before approval."]},result:{status:"failed",baseline:[{command:"npm test",exitCode:0,output:"passed"}],patched:[{command:"npm test",exitCode:1,output:"Assertion failed"}],cleanupComplete:true,errors:["patched tests failed."]}};
test("deep linked failed repair explains recovery without repeating execution",async({page})=>{
 let writes=0;
 await page.route("**/api/session",r=>r.fulfill({json:{actor:{id:"github:123"}}}));
 await page.route("**/api/scans",r=>r.fulfill({json:{scans:[]}}));
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[repair.repository]}}));
 await page.route("**/api/repairs",r=>r.fulfill({json:{repairs:[]}}));
 await page.route(`**/api/repairs/${id}`,r=>{if(r.request().method()!=="GET")writes++;return r.fulfill({json:repair});});
 await page.goto(`/repairs?repair=${id}`);
 const recovery=page.getByRole("region",{name:"Verification recovery"});
 await expect(recovery).toContainText("patched tests failed.");
 await expect(page.getByRole("heading",{name:"team/demo · lodash",exact:true})).toBeFocused();
 await expect(page.getByRole("button",{name:"Run isolated verification"})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Approve and create draft PR"})).toHaveCount(0);
 await expect(page.getByRole("link",{name:"Sign in with GitHub"})).toHaveCount(0);
 await page.getByRole("button",{name:"Prepare a fresh proposal"}).click();
 await expect(page.getByLabel("Dependency package name")).toHaveValue("lodash");
 await expect(page.getByLabel("Dependency package name")).toBeFocused();
 expect(writes).toBe(0);
 await page.reload();await expect(recovery).toBeVisible();expect(writes).toBe(0);
});
test("history errors are not rendered as empty history and support read-only retry",async({page})=>{
 let reads=0;
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[]}}));
 await page.route("**/api/repairs",r=>{reads++;return r.fulfill(reads===1?{status:503,json:{error:"Database unavailable"}}:{json:{repairs:[]}});});
 await page.goto("/repairs");
 await expect(page.getByText("Saved repairs could not be loaded:",{exact:false})).toBeVisible();
 await expect(page.getByText("No repairs yet.",{exact:false})).toHaveCount(0);
 await page.getByRole("button",{name:"Refresh saved repairs"}).click();
 await expect(page.getByText("No repairs yet.",{exact:false})).toBeVisible();
});
test("finding handoff prefills package but never assumes repository",async({page})=>{
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[repair.repository]}}));
 await page.route("**/api/repairs",r=>r.fulfill({json:{repairs:[]}}));
 await page.goto("/repairs?package=lodash");
 await expect(page.getByLabel("Dependency package name")).toHaveValue("lodash");
 await expect(page.getByLabel("GitHub repository")).toHaveValue("");
 await expect(page.getByRole("button",{name:"Propose repair",exact:true})).toBeDisabled();
});

test("repository finding handoff prepares the exact target without redundant fields",async({page})=>{
 const posts:unknown[]=[];
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[{id:2,full_name:"team/other"},repair.repository]}}));
 await page.route("**/api/repairs",r=>{if(r.request().method()==="POST"){posts.push(r.request().postDataJSON());return r.fulfill({json:{id}});}return r.fulfill({json:{repairs:[]}});});
 await page.route(`**/api/repairs/${id}`,r=>r.fulfill({json:{...repair,state:"proposed",result:undefined}}));
 await page.goto('/repairs?package=lodash&repository=team%2Fdemo&report=22222222-2222-4222-8222-222222222222');
 await expect(page.getByRole('button',{name:'Prepare repair',exact:true})).toBeEnabled();
 await expect(page.getByLabel('GitHub repository')).toHaveCount(0);
 expect(posts).toEqual([]);
 await page.screenshot({path:'test-results/repair-context-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'test-results/repair-context-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Prepare repair',exact:true}).click();
 await expect(page.getByRole('button',{name:'Run isolated verification'})).toBeVisible();
 expect(posts).toEqual([{repositoryId:1,packageName:'lodash',sourceReportId:'22222222-2222-4222-8222-222222222222'}]);
});
test("unavailable handoff repository never falls back to another connected repository",async({page})=>{
 await page.route("**/api/repositories",r=>r.fulfill({json:{repositories:[repair.repository]}}));
 await page.route("**/api/repairs",r=>r.fulfill({json:{repairs:[]}}));
 await page.goto('/repairs?package=next&repository=team%2Funavailable');
 await expect(page.getByRole('button',{name:'Prepare repair',exact:true})).toBeDisabled();
 await expect(page.getByRole('alert').filter({hasText:'not in your connected access list'})).toBeVisible();
});
