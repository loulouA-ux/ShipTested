import { neon } from "@neondatabase/serverless";
import { localDatabase } from "./local-database";
export type Row = Record<string, unknown>;
export type QueryOptions = {serializable?:boolean};
export type Query = (text: string, params?: unknown[], options?:QueryOptions) => Promise<Row[]>;
/** Retry only database-confirmed transaction aborts, never uncertain network errors. */
export async function retrySerializable<T>(run:()=>Promise<T>):Promise<T>{
  for(let attempt=0;;attempt++){
    try{return await run();}catch(error){
      const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';
      if(attempt>=3||!['40001','40P01'].includes(code))throw error;
      await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)));
    }
  }
}
export function database(): Query {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Database is not configured.");
  if (process.env.SHIPTESTED_LOCAL_POSTGRES === '1') return localDatabase(url);
  const sql = neon(url);
  return async (text, params = [],options={}) => {
    if(options.serializable)return retrySerializable(async()=>{
      const result=await sql.transaction([sql.query(text,params)],{isolationLevel:'Serializable'});
      return result[0] as Row[];
    });
    return (await sql.query(text, params)) as Row[];
  };
}
