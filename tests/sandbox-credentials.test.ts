import {it,expect} from 'vitest';
import {sandboxCredentials} from '../src/lib/repair/credentials';
const now=1700000000000;
const oidc=(payload:unknown)=>`header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
it('uses explicit scope without any SDK project inference',()=>{
  expect(sandboxCredentials({VERCEL_TOKEN:'synthetic-token',VERCEL_TEAM_ID:'team_test',VERCEL_PROJECT_ID:'prj_test'},now)).toEqual({token:'synthetic-token',teamId:'team_test',projectId:'prj_test'});
  const token=oidc({exp:now/1000+60,owner_id:'team_test',project_id:'prj_test'});
  expect(sandboxCredentials({VERCEL_OIDC_TOKEN:token},now)).toEqual({token,teamId:'team_test',projectId:'prj_test'});
});
it.each([
  {},{VERCEL_TOKEN:'synthetic-token'},
  {VERCEL_OIDC_TOKEN:oidc({exp:now/1000-1,owner_id:'team_test',project_id:'prj_test'})},
  {VERCEL_OIDC_TOKEN:oidc({exp:now/1000+60})},
  {VERCEL_OIDC_TOKEN:'invalid'},
])('rejects absent, partial, expired or unscoped credentials before compute %j',env=>expect(()=>sandboxCredentials(env,now)).toThrow());
