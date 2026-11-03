import Link from 'next/link';
import {repairHandoff} from '../repair-handoff';
import {ArrowLeft,ArrowRight,ChevronRight,Info} from 'lucide-react';
import type {Finding,ScanReport,Evidence} from '@/lib/types';
import advisory from '../../../fixtures/lodash-advisory.json';
import {severityLabel,actionParts,plural} from '../components/presentation';
import styles from '../findings.module.css';
import DecisionLog from '../decision-log';
import {SourcePreview} from '../report-insights';
function AdvisoryMetadata({evidence:e}:{evidence:Evidence}){if(e.url!==`https://osv.dev/vulnerability/${advisory.id}`)return null;const affected=advisory.affected.find(a=>a.package.name===e.dependency?.name&&a.package.ecosystem===e.dependency?.ecosystem);return <dl className="advisory-metadata"><dt>Advisory</dt><dd>{advisory.id}</dd><dt>Aliases</dt><dd>{advisory.aliases.join(', ')}</dd><dt>CVSS vector</dt><dd>{advisory.severity.map(s=>s.score).join(', ')}</dd><dt>CWE</dt><dd>{advisory.database_specific.cwe_ids.join(', ')}</dd>{affected&&<><dt>Affected range / fixes</dt><dd>{affected.ranges.flatMap(r=>r.events.map(e=>Object.entries(e).map(([k,v])=>`${k==='fixed'?'Fixed in':k} ${v}`).join(', '))).join('; ')}</dd></>}</dl>}
export default function FindingDetail({finding,report,close}:{finding:Finding;report:ScanReport;close:()=>void}){const handoff=repairHandoff(report,finding);const repairDependency=finding.evidence.find(e=>e.dependency?.ecosystem==='npm')?.dependency;const fixed= finding.evidence.some(e=>e.url===`https://osv.dev/vulnerability/${advisory.id}`)?advisory.affected.find(a=>a.package.name===repairDependency?.name&&a.package.ecosystem===repairDependency?.ecosystem)?.ranges.flatMap(r=>r.events.map(e=>'fixed' in e?e.fixed:undefined)).find(Boolean):undefined;const affected=finding.evidence.find(e=>e.kind==='advisory'&&e.dependency)?.dependency;const index=report.findings.findIndex(f=>f.id===finding.id);const findingHref=(id:string)=>`/reports/${encodeURIComponent(report.id)}/findings/${encodeURIComponent(id)}`;return <>
<nav className="report-breadcrumb" aria-label="Breadcrumb"><Link href="/reports">Reports</Link><span>/</span><Link href={`/reports/${encodeURIComponent(report.id)}`}>Report</Link><span>/ Finding {index+1} of {report.findings.length}</span><span className="finding-pager">{index>0&&<Link className="button" aria-label="Previous finding" href={findingHref(report.findings[index-1].id)}><ArrowLeft size={16}/></Link>}{index<report.findings.length-1&&<Link className="button" aria-label="Next finding" href={findingHref(report.findings[index+1].id)}><ArrowRight size={16}/></Link>}</span></nav>
              <button className="back" onClick={() => close()}>
                <ArrowLeft size={15} />
                Back to report
              </button>
              <div className="finding-workspace">
                <section className="finding-summary" aria-label="Finding and recommended action">
              <span className={"severity " + finding.severity}>
                {severityLabel(finding.severity)}{finding.severity==='review'&&<small>Needs human review</small>}
              </span>
              <h1 tabIndex={-1} className="detail-title">{finding.title}</h1>
              <p className="intro">{affected?`${affected.name}@${affected.version} is in this advisory's affected range. Whether your app calls the vulnerable function hasn't been checked.`:finding.description}</p>
              <section className="panel">
                <h2>Recommended action</h2>
                {fixed&&repairDependency&&<p className="change-chip">{repairDependency.name} {repairDependency.version} → {fixed} <span>Fixed in {fixed}</span></p>}<p>{actionParts(finding.action)[0]}</p>{actionParts(finding.action).length>1&&<details><summary>Action context</summary><p>{actionParts(finding.action).slice(1).join(" ")}</p></details>}
                {handoff && <div className={`${styles.handoff} finding-repair-action`}>{handoff.supported?<><Link className="button primary" href={handoff.href}>Prepare tested repair <ChevronRight size={15}/></Link><p>{handoff.repository?`Repair ${handoff.dependency.name} in ${handoff.repository}. Repository details carry through automatically.`:"This report has no repository context. Choose a connected repository to prepare the repair."}</p></>:<p>This finding is in a nested npm project. Automated repair currently supports root package.json and package-lock.json only; update the manifest shown in the evidence below.</p>}</div>}
                <div className="quiet-note">
                  <Info size={16} />
                  No code has been changed.
                </div>
              </section>
                </section>
              <section className="panel evidence-pane" aria-label="Source evidence">
                <div className="evidence-heading"><h2>Evidence</h2><span>{plural(finding.evidence.length,"source")}</span></div><p className="muted">Evidence recorded for this finding. Open the original source to check its context.</p>
                {finding.evidence.map((e, i) => (
                  <div className="evidence" key={i}>
                    <span className="evidence-kind">{e.kind === "advisory" ? "Advisory" : e.kind === "http" ? "HTTP observation" : "Code evidence"}</span>
                    {!e.dependency&&<div className="code-label">{e.location}</div>}
                    {e.dependency && <p className="evidence-dependency">{e.dependency.name}@{e.dependency.version}<br/><code>{e.dependency.path}</code></p>}
                    <AdvisoryMetadata evidence={e}/><dl className="advisory-metadata">{e.dependency&&<><dt>Package</dt><dd>{e.dependency.name}@{e.dependency.version}</dd><dt>Ecosystem</dt><dd>{e.dependency.ecosystem}</dd></>}<dt>Exploitability</dt><dd>Not assessed</dd></dl><pre>{e.excerpt}</pre>
                    {e.url && /^https?:\/\//i.test(e.url) && (
                      <><a className="external-source" href={e.url} target="_blank" rel="noreferrer">{e.url.startsWith("https://osv.dev/")?"Open on OSV ↗":"Open original source ↗"}</a><SourcePreview title={e.location} excerpt={e.excerpt} url={e.url} retrievedAt={e.retrievedAt}/></>
                    )}
                    {e.retrievedAt && (
                      <small>
                        Retrieved{" "}
                        {new Date(e.retrievedAt).toLocaleDateString("en-GB")}
                      </small>
                    )}
                  </div>
                ))}
              </section>
              </div>
              {report && (
                <DecisionLog
                  key={finding.id}
                  report={report}
                  findingId={finding.id}
                />
              )}
              {report?.explanations
                .filter((e) => e.findingId === finding.id)
                .map((e, i) => (
                  <section className="panel" key={i}>
                    <h2>{e.basis === "validated-selection" ? "Nemotron-selected note · quoted from scanner evidence" : "Scanner evidence note"}</h2>
                    <p>{e.basis ? e.explanation : finding.description}</p>
                    <small>
                      {e.basis === "validated-selection" ? "Selected verbatim from scanner-authored notes; no generated claims." : "Scanner fallback. Unvalidated model wording is not displayed."}
                    </small>
                  </section>
                ))}
</>}
