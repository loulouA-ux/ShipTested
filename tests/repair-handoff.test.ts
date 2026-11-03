import {describe,it,expect} from 'vitest';
import {repairHandoff} from '../src/app/repair-handoff';
import type {ScanReport,Finding} from '../src/lib/types';
const report={id:'report-1',repositoryScan:{repository:'team/app'}} as unknown as ScanReport;
const finding=(path:string)=>({evidence:[{dependency:{ecosystem:'npm',name:'@team/pkg',version:'1.0.0',path}}]} as Finding);
describe('repair handoff',()=>{
 it('retains repository and report provenance with an encoded package',()=>{
  const h=repairHandoff(report,finding('package-lock.json:node_modules/@team/pkg'))!;
  const p=new URL(h.href,'https://example.test').searchParams;
  expect(Object.fromEntries(p)).toEqual({package:'@team/pkg',repository:'team/app',report:'report-1'});expect(h.supported).toBe(true);
 });
 it('does not send a nested manifest to the root repair engine',()=>expect(repairHandoff(report,finding('apps/web/package-lock.json:node_modules/@team/pkg'))?.supported).toBe(false));
 it('does not invent provenance for an uploaded report',()=>expect(repairHandoff({id:'upload'} as ScanReport,finding('node_modules/@team/pkg'))?.href).toBe('/repairs?package=%40team%2Fpkg'));
});
