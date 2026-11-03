import {afterEach,expect,it,vi} from 'vitest';
import {hostedTransport} from '../packages/cli/src/transport';
afterEach(()=>vi.unstubAllEnvs());
it('is opt-in and refuses origins outside the exact protected preview',()=>{
 vi.stubEnv('SHIPTESTED_VERCEL_TRANSPORT','');expect(hostedTransport('https://example.com')).toBe(fetch);
 vi.stubEnv('SHIPTESTED_VERCEL_TRANSPORT','1');expect(()=>hostedTransport('https://example.com')).toThrow();
});
it('rejects credential forwarding and non-API destinations before invoking Vercel',async()=>{
 vi.stubEnv('SHIPTESTED_VERCEL_TRANSPORT','1');const origin='https://shipcheck-git-codex-hosted-workflow-hey-salad-inc.vercel.app',f=hostedTransport(origin);
 await expect(f('https://evil.example/api/usage')).rejects.toThrow('Invalid preview');
 await expect(f(origin+'/api/usage')).rejects.toThrow('authentication');
 await expect(f(origin+'/api/usage?token=bad')).rejects.toThrow('Invalid preview');
});
