'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {RefreshCw} from 'lucide-react';
import type {ReportComparison as Comparison} from '@/lib/report-comparison';
export default function ReportComparison({id}:{id:string}) {
  const [comparison,setComparison]=useState<Comparison|null>(null);
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setComparison(null);setFailed(false);
    void fetch(`/api/scans/${encodeURIComponent(id)}/comparison`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error();const result=await response.json();setComparison(result.comparison);})
      .catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return ()=>controller.abort();
  },[id,attempt]);
  if(failed)return <section className="panel scope" aria-label="Scan comparison"><h2>Changes since your previous scan</h2><p>Comparison could not be loaded. Your current report is still available.</p><button className="button" onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={16} aria-hidden="true"/>Retry comparison</button></section>;
  if(!comparison)return null;
  return <section className="panel scope" aria-label="Scan comparison"><h2>Changes since your previous scan</h2>
    <p><strong>{comparison.added} new</strong> · {comparison.unchanged} unchanged · {comparison.noLongerObserved} no longer detected</p>
    <p>Advisory, package and dependency-path matches compared with <Link href={`/reports/${encodeURIComponent(comparison.previousReportId)}`}>your previous report</Link> at commit <code>{comparison.previousCommit.slice(0,7)}</code>.</p>
    <p>{comparison.coverageComparable?'Both scans completed their supported checks over the same manifest paths. No longer detected means absent from this dependency scan; application security is not established.':'Coverage differs or is incomplete. Missing matches are unconfirmed; they cannot be counted as resolved.'}</p>
  </section>;
}
