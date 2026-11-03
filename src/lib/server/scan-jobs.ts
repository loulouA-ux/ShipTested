import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Query, Row } from './db';
import type { Actor } from './store';
import { ApiError } from './http';
import { maskSecrets } from '@heysalad/shiptested';
import type { RepositoryReport } from './repository-scan';

const request = z.object({
  requestKey: z.string().uuid(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  tree: z.string().regex(/^[a-f0-9]{40}$/),
  private: z.boolean(),
  privateAccess: z.boolean().optional(),
}).strict();
export type JobRequest = z.infer<typeof request>;

/** Internal persistence boundary. Callers must authorise repository access first.
 * Allowances are provisioned by trusted server code, never client input.
 * Reservations count accepted attempts, not findings or claims of successful scans.
 */
export class ScanJobs {
  constructor(private readonly query: Query) {}

  private async existing(actor: Actor, key: string) {
    const [row] = await this.query('SELECT * FROM sc_scan_jobs WHERE workspace_id=$1 AND owner_id=$2 AND request_key=$3', [actor.workspaceId, actor.id, key]);
    return row;
  }

  /** A retry retains the originally pinned commit even if the default branch moves. */
  async submitted(actor:Actor,key:string,repository:string,privateAccess:boolean) {
    if(!z.string().uuid().safeParse(key).success)throw new ApiError(400,'Invalid request key.');
    const row=await this.existing(actor,key);
    if(row&&(String(row.repository).toLowerCase()!==repository.toLowerCase()||row.requested_private_access!==privateAccess))
      throw new ApiError(409,'This request key belongs to a different scan.');
    return row;
  }

  private sameRequest(row: Row, input: JobRequest) {
    if (String(row.repository).toLowerCase() !== input.repository.toLowerCase() || row.requested_private_access !== (input.privateAccess??input.private))
      throw new ApiError(409, 'This request key belongs to a different scan.');
    return row;
  }

  async enqueue(actor: Actor, input: JobRequest) {
    const parsed = request.safeParse(input);
    if (!parsed.success) throw new ApiError(400, 'Invalid repository scan request.');
    input = parsed.data;
    const previous = await this.existing(actor, input.requestKey);
    if (previous) return this.sameRequest(previous, input);
    try {
      // One statement: a failed insert rolls back the allowance reservation too.
      const [job] = await this.query(`WITH allowance AS (
        UPDATE sc_scan_allowances SET reserved=reserved+1
        WHERE workspace_id=$1 AND period_start=(date_trunc('month',now() AT TIME ZONE 'UTC'))::date
        AND reserved < scan_limit RETURNING period_start
      ), changed AS (INSERT INTO sc_scan_jobs(id,workspace_id,owner_id,request_key,repository,commit_sha,period_start,tree_sha,private_repository,requested_private_access)
        SELECT $3,$1,$2,$4,$5,$6,period_start,$7,$8,$9 FROM allowance RETURNING *), audit AS (
        INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id)
        SELECT workspace_id,owner_id,'scan_queued',id::text FROM changed
      ) SELECT * FROM changed`,
      [actor.workspaceId, actor.id, randomUUID(), input.requestKey, input.repository, input.commit,input.tree,input.private,input.privateAccess??input.private]);
      if (job) return job;
    } catch (error) {
      // Concurrent identical requests can hit the unique key; return the winner.
      const winner = await this.existing(actor, input.requestKey);
      if (winner) return this.sameRequest(winner, input);
      throw error;
    }
    const winner = await this.existing(actor, input.requestKey);
    if (winner) return this.sameRequest(winner, input);
    throw new ApiError(429, 'No scan allowance remains for this workspace.');
  }

  async get(actor: Actor, id: string) {
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'Invalid scan job ID.');
    const [job] = await this.query('SELECT * FROM sc_scan_jobs WHERE id=$1 AND workspace_id=$2 AND owner_id=$3', [id, actor.workspaceId, actor.id]);
    if (!job) throw new ApiError(404, 'Scan job not found.');
    return job;
  }

  async cancelQueued(actor: Actor, id: string) {
    await this.get(actor, id);
    const [job] = await this.query(`WITH changed AS (UPDATE sc_scan_jobs SET state='cancelled',updated_at=now() WHERE id=$1 AND workspace_id=$2 AND owner_id=$3 AND state='queued' RETURNING *), audit AS (INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id) SELECT workspace_id,owner_id,'scan_cancelled',id::text FROM changed) SELECT * FROM changed`, [id, actor.workspaceId, actor.id]);
    if (!job) throw new ApiError(409, 'Only queued scans can be cancelled here.');
    return job;
  }

  /** Trusted worker only: fencing token prevents expired workers publishing results. */
  async claim() {
    const token = randomUUID();
    const [job] = await this.query(`WITH candidate AS (
      SELECT id FROM sc_scan_jobs WHERE attempts < 3 AND
      (state='queued' OR (state='running' AND lease_expires_at < now()))
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ), changed AS (UPDATE sc_scan_jobs j SET state='running',attempts=attempts+1,
      lease_token=$1,lease_expires_at=now()+interval '5 minutes',updated_at=now()
      FROM candidate WHERE j.id=candidate.id RETURNING j.*), audit AS (
      INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id)
      SELECT workspace_id,owner_id,'scan_started',id::text FROM changed
    ) SELECT * FROM changed`, [token]);
    return job ?? null;
  }

  async finish(id: string, token: string, result: {reportId:string} | {failureCode:'scan_failed'|'unsupported_repository'|'provider_unavailable'}) {
    const reportId = 'reportId' in result ? result.reportId : null;
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(token).success ||
      (reportId !== null && !z.string().uuid().safeParse(reportId).success))
      throw new ApiError(400, 'Invalid worker result identity.');
    const [job] = await this.query(`WITH changed AS (UPDATE sc_scan_jobs SET state=$3,report_id=$4,failure_code=$5,
      lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_expires_at > now() RETURNING *), audit AS (
      INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id)
      SELECT workspace_id,owner_id,'scan_'||state,id::text FROM changed
    ) SELECT * FROM changed`,
      [id,token,reportId?'completed':'failed',reportId,'failureCode' in result?result.failureCode:null]);
    if (!job) throw new ApiError(409, 'Worker lease expired or job already finished.');
    return job;
  }

  async expireExhausted() {
    return this.query(`WITH changed AS (UPDATE sc_scan_jobs SET state='failed',failure_code='retry_exhausted',
      lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE state='running' AND attempts=3 AND lease_expires_at < now() RETURNING *), audit AS (
      INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id)
      SELECT workspace_id,owner_id,'scan_retry_exhausted',id::text FROM changed
    ) SELECT id FROM changed`);
  }

  async saveReport(id:string,token:string,report:RepositoryReport) {
    const [job]=await this.query(`WITH live AS (
      SELECT * FROM sc_scan_jobs WHERE id=$1 AND lease_token=$2 AND state='running'
      AND lease_expires_at>now() AND repository=$5 AND commit_sha=$6 FOR UPDATE
    ), saved AS (
      INSERT INTO sc_scans(id,workspace_id,owner_id,report)
      SELECT $3,workspace_id,owner_id,$4::jsonb FROM live RETURNING id
    ), changed AS (UPDATE sc_scan_jobs SET state='completed',report_id=saved.id,lease_token=NULL,
      lease_expires_at=NULL,updated_at=now() FROM saved WHERE sc_scan_jobs.id=$1 RETURNING sc_scan_jobs.*), audit AS (
      INSERT INTO sc_workspace_events(workspace_id,actor_id,event_type,subject_id)
      SELECT workspace_id,owner_id,'scan_completed',id::text FROM changed
    ) SELECT * FROM changed`,
    [id,token,report.id,maskSecrets(JSON.stringify(report)),report.repositoryScan.repository,report.repositoryScan.commit]);
    if(!job)throw new ApiError(409,'Worker lease or report source no longer matches.');
    return job;
  }
}
