import {it,expect} from 'vitest';
import {boundedJson} from '../src/lib/providers';
it('keeps the default 1 MB bound and enforces the explicit tree budget on streamed bytes',async()=>{
 const big=()=>new Response(JSON.stringify({value:'x'.repeat(1_000_000)}));
 await expect(boundedJson('https://api.github.com',{},async()=>big())).rejects.toThrow('too large');
 expect(await boundedJson('https://api.github.com',{},async()=>big(),8_000_000)).toHaveProperty('value');
 await expect(boundedJson('https://api.github.com',{},async()=>new Response('x'.repeat(8_000_001)),8_000_000)).rejects.toThrow('too large');
 await expect(boundedJson('https://api.github.com',{},async()=>big(),8_000_001)).rejects.toThrow('Invalid');
});
it('preserves cancellation supplied by the repository discovery deadline',async()=>{
 const controller=new AbortController();controller.abort();
 await boundedJson('https://api.github.com',{signal:controller.signal},async(_url,init)=>{expect(init?.signal?.aborted).toBe(true);return Response.json({});});
});
