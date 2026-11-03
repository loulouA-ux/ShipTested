import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {ApiError} from '../src/lib/server/http';
const mocks=vi.hoisted(()=>({database:vi.fn(),actor:vi.fn(),ready:vi.fn(),status:vi.fn(),approve:vi.fn(),reconcile:vi.fn()}));
vi.mock('../src/lib/server/db',()=>({database:mocks.database}));
vi.mock('../src/lib/server/session',()=>({requireActor:mocks.actor}));
vi.mock('../src/lib/server/repair-merge',()=>({repairMergeReadiness:mocks.ready,repairMergeStatus:mocks.status,approveRepairMerge:mocks.approve,reconcileRepairMerge:mocks.reconcile}));
import {GET,POST} from '../src/app/api/repairs/[id]/merge/route';
const id='22222222-2222-4222-8222-222222222222',actor={id:'github:1',workspaceId:'github:1',role:'member'},query=vi.fn();
function invoke(method:'GET'|'POST',data?:unknown,options:{id?:string;origin?:string;statusOnly?:boolean}={}){
 const request=new Request(`https://shiptested.test/api/repairs/${options.id??id}/merge${options.statusOnly?'?status=1':''}`,{method,headers:{origin:options.origin??'https://shiptested.test'},...(method==='POST'?{body:JSON.stringify(data)}:{})});
 return (method==='GET'?GET:POST)(request,{params:Promise.resolve({id:options.id??id})});
}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('SHIPTESTED_PUBLIC_DEMO','0');vi.stubEnv('SHIPTESTED_APP_ORIGIN','https://shiptested.test');mocks.database.mockReturnValue(query);mocks.actor.mockResolvedValue(actor);mocks.ready.mockResolvedValue({ready:false});mocks.status.mockResolvedValue({ready:false,record:null});mocks.approve.mockResolvedValue({state:'pending'});mocks.reconcile.mockResolvedValue({state:'merged'});});
afterEach(()=>vi.unstubAllEnvs());
describe('repair merge HTTP boundary',()=>{
 it.each(['GET','POST'] as const)('%s rejects malformed IDs before auth/database and missing sessions before actions',async(method)=>{
  expect((await invoke(method,{action:'reconcile'},{id:'invalid'})).status).toBe(400);expect(mocks.database).not.toHaveBeenCalled();
  mocks.actor.mockRejectedValue(new ApiError(401,'Sign in first.'));expect((await invoke(method,{action:'reconcile'})).status).toBe(401);
  expect(mocks.ready).not.toHaveBeenCalled();expect(mocks.reconcile).not.toHaveBeenCalled();
 });
 it('rejects cross-origin writes before authentication',async()=>{
  expect((await invoke('POST',{action:'reconcile'},{origin:'https://other.test'})).status).toBe(403);expect(mocks.actor).not.toHaveBeenCalled();expect(mocks.reconcile).not.toHaveBeenCalled();
 });
 it.each([{}, {action:'approve'}, {action:'approve',approvalHash:'a'.repeat(64)}, {action:'approve',approvalHash:'a'.repeat(64),confirmMerge:false}, {action:'approve',approvalHash:'a'.repeat(64),confirmMerge:true,url:'https://other.test'}, {action:'merge'}, {action:'reconcile',confirmMerge:true}])('rejects missing or ambiguous approval %j',async(data)=>{
  expect((await invoke('POST',data)).status).toBe(400);expect(mocks.approve).not.toHaveBeenCalled();expect(mocks.reconcile).not.toHaveBeenCalled();
 });
 it('passes only the authenticated actor and exact hash to the merge service',async()=>{
  expect((await invoke('POST',{action:'approve',approvalHash:'a'.repeat(64),confirmMerge:true})).status).toBe(200);expect(mocks.approve).toHaveBeenCalledWith(query,actor,id,'a'.repeat(64));
 });
 it('keeps status-only reads separate from provider preflight and reconciliation separate from approval',async()=>{
  expect((await invoke('GET',undefined,{statusOnly:true})).status).toBe(200);expect(mocks.status).toHaveBeenCalledWith(query,actor,id);expect(mocks.ready).not.toHaveBeenCalled();
  expect((await invoke('GET')).status).toBe(200);expect(mocks.ready).toHaveBeenCalledWith(query,actor,id);
  expect((await invoke('POST',{action:'reconcile'})).status).toBe(200);expect(mocks.reconcile).toHaveBeenCalledWith(query,actor,id);expect(mocks.approve).not.toHaveBeenCalled();
 });
 it('does not expose raw provider errors or credentials',async()=>{
  mocks.ready.mockRejectedValue(new Error('sensitive-provider-token'));const response=await invoke('GET');expect(response.status).toBe(503);expect(await response.text()).not.toContain('sensitive-provider-token');
 });
});
