/** Fail before reserving a run; never let the SDK infer/create a project or prompt. */
export function sandboxCredentials(env:Record<string,string|undefined>=process.env,now=Date.now()){
  const token=env.VERCEL_TOKEN,teamId=env.VERCEL_TEAM_ID,projectId=env.VERCEL_PROJECT_ID;
  if(token&&teamId&&projectId){
    if(!/^team_[A-Za-z0-9]+$/.test(teamId)||!/^prj_[A-Za-z0-9]+$/.test(projectId))throw Error('Explicit sandbox project scope is invalid.');
    return {token,teamId,projectId};
  }
  if(token||teamId||projectId)throw Error('Sandbox API credentials require token, team and project together.');
  try{
    const value=env.VERCEL_OIDC_TOKEN;
    if(!value||value.length>32000)throw Error();
    const payload=JSON.parse(Buffer.from(value.split('.')[1]||'','base64url').toString());
    if(typeof payload.exp!=='number'||payload.exp*1000<=now||
      typeof payload.owner_id!=='string'||!/^team_[A-Za-z0-9]+$/.test(payload.owner_id)||
      typeof payload.project_id!=='string'||!/^prj_[A-Za-z0-9]+$/.test(payload.project_id))throw Error();
    return {token:value,teamId:payload.owner_id as string,projectId:payload.project_id as string};
  }catch{throw Error('A current project-scoped sandbox credential is required. Refresh development OIDC configuration before verification.');}
}
