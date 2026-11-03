/** Managed workflow client. The origin is explicit configuration, never tool input. */
export class HostedClient {
  readonly origin:string;
  constructor(origin:string,private token:string,private fetcher:typeof fetch=fetch,private timeoutMs=30000){
    if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw Error('Invalid hosted request deadline.');
    const url=new URL(origin);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||(url.protocol==='http:'&&url.hostname==='127.0.0.1')))throw Error('Use an HTTPS API origin or local 127.0.0.1 development origin.');
    if(!/^st_[a-f0-9]{64}$/.test(token))throw Error('Set a valid ShipTested agent token privately.');
    this.origin=url.origin;
  }
  private async request(path:string,method='GET',data?:unknown):Promise<Record<string,unknown>>{
    const response=await this.fetcher(this.origin+path,{method,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(this.timeoutMs),headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
    if(!response.ok){await response.body?.cancel();throw Error(`ShipTested request failed (HTTP ${response.status}). Check access, allowance and service configuration.`);}
    const reader=response.body?.getReader();if(!reader)throw Error('Empty ShipTested response.');
    const chunks:Uint8Array[]=[];let size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000)throw Error('ShipTested response exceeds 2 MB.');chunks.push(value);}}finally{await reader.cancel();}
    const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
    const value:unknown=JSON.parse(new TextDecoder().decode(all));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid ShipTested response.');return value as Record<string,unknown>;
  }
  private id(id:string){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw Error('Use a valid scan or report ID.');return id;}
  scanRepository(repository:string,privateAccess=false,requestKey:string=crypto.randomUUID()) {
    if(repository.length>250)throw Error('Repository URL is too long.');
    this.id(requestKey);return this.request('/api/repository-scans','POST',{repository,privateAccess,requestKey});
  }
  job(id:string){return this.request(`/api/repository-scans/${this.id(id)}`);}
  report(id:string){return this.request(`/api/scans/${this.id(id)}`);}
  repositories(){return this.request('/api/repositories');}
  usage(){return this.request('/api/usage');}
}
