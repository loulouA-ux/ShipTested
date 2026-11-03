import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { Store, type Actor } from "../src/lib/server/store";
import type { Query } from "../src/lib/server/db";
import {
  hash,
  createSession,
  requireActor,
  revokeSession,
  sessionCookie,
} from "../src/lib/server/session";
import { runScan } from "../src/lib/pipeline";
import { POST } from "../src/app/api/scans/route";
const db = new PGlite();
const query: Query = async (text, params = []) =>
  (await db.query(text, params)).rows as Record<string, unknown>[];
const store = new Store(query);
const peter: Actor = {
    id: "peter",
    workspaceId: "shipcheck-team",
    role: "member",
  },
  louise: Actor = { ...peter, id: "louise" };
const key = "sc_" + "a".repeat(64);
beforeAll(async () => {
  await db.exec(readFileSync("migrations/001_core.sql", "utf8"));
for(const f of ['002_hosted_jobs','003_workspaces','004_team_sharing','009_batch_retry'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8'));
  await db.exec(readFileSync("migrations/001_core.sql", "utf8"));
});
afterAll(() => db.close());
afterEach(() => vi.unstubAllEnvs());
describe("real Postgres storage boundary", () => {
  it("isolates projects by BOTH actor and workspace, with parameterized input", async () => {
    const p = await store.createProject(
      peter,
      "name '); DROP TABLE sc_projects; --",
      "https://staging.example.com",
    );
    expect((await store.getProject(peter, p.id)).hostname).toBe(
      "staging.example.com",
    );
    await expect(store.getProject(louise, p.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      store.getProject({ ...peter, workspaceId: "other" }, p.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(await store.listProjects(louise)).toEqual([]);
  });
  it("rejects verification against rotated or expired challenges", async () => {
    const p = await store.createProject(
      peter,
      "proof",
      "https://proof.example.com",
    );
    const refreshed = await store.refreshChallenge(peter, p.id);
    await expect(
      store.markVerified(peter, p.id, p.challenge.token, "dns"),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await store.markVerified(peter, p.id, refreshed.challenge.token, "dns"))
        .proofMethod,
    ).toBe("dns");
    await query(
      "UPDATE sc_projects SET challenge=jsonb_set(challenge,'{expiresAt}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id=$1",
      [p.id],
    );
    await expect(
      store.markVerified(peter, p.id, refreshed.challenge.token, "dns"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("enforces quota under competing requests", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        store.quota("test-limit", 3, 60000, 1000),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(5);
  });
  it("masks stored evidence and preserves verdict across decision events", async () => {
    await query("INSERT INTO sc_workspaces(id,owner_id,name) VALUES($1,$2,'Test')",[peter.workspaceId,peter.id]);
    const report = await runScan({ mode: "demo" });
    // Storage uses UUIDs for member scans; demo replay IDs are never persisted.
    report.id = "df44ab44-2b67-4918-abf0-d588b0a2572d";
    report.findings[0].description = "sk_live_" + "B".repeat(24);
    await store.saveScan(peter, report);
    const original = await store.getScan(peter, report.id);
    expect(JSON.stringify(original)).not.toContain("B".repeat(24));
    await expect(store.getScan(louise, report.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      store.decide(louise, report.id, report.findings[0].id, "dismiss", ""),
    ).rejects.toMatchObject({ status: 404 });
    await store.decide(
      peter,
      report.id,
      report.findings[0].id,
      "dismiss",
      "checked",
    );
    await store.decide(
      peter,
      report.id,
      report.findings[0].id,
      "acknowledge",
      "reconsidered",
    );
    expect(await store.getScan(peter, report.id)).toEqual(original);
    const decisions=await store.decisions(peter, report.id);
    expect(decisions).toHaveLength(2);
    const history=await query('SELECT event_type,subject_id FROM sc_workspace_events WHERE workspace_id=$1 ORDER BY sequence',[peter.workspaceId]);
    expect(history).toEqual([{event_type:'report_saved',subject_id:report.id},{event_type:'finding_dismiss',subject_id:decisions[0].id},{event_type:'finding_acknowledge',subject_id:decisions[1].id}]);
    expect(JSON.stringify(history)).not.toContain('checked');
    await expect(
      store.decide(peter, report.id, "invented", "dismiss", ""),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("creates hashed sessions; rejects forged, revoked and rotated identities", async () => {
    vi.stubEnv("SHIPCHECK_PETER_KEY_HASH", hash(key));
    const s = await createSession(query, key);
    const request = new Request("https://app.example/api/scans", {
      headers: {
        cookie: "shipcheck_session=" + s.token,
        "x-user-id": "louise",
      },
    });
    expect(await requireActor(request, query)).toEqual(peter);
    const rows = await query("SELECT * FROM sc_sessions");
    expect(JSON.stringify(rows)).not.toContain(s.token);
    expect(JSON.stringify(rows)).not.toContain(key);
    vi.stubEnv("SHIPCHECK_PETER_KEY_HASH", hash("new-key"));
    await expect(requireActor(request, query)).rejects.toMatchObject({
      status: 401,
    });
    vi.stubEnv("SHIPCHECK_PETER_KEY_HASH", hash(key));
    await revokeSession(request, query);
    await expect(requireActor(request, query)).rejects.toMatchObject({
      status: 401,
    });
    expect(sessionCookie(s.token, request)).toContain(
      "HttpOnly; SameSite=Strict",
    );
    expect(sessionCookie(s.token, request)).toContain("Secure");
  });
  it("rejects expired sessions and invalid member keys", async () => {
    vi.stubEnv("SHIPCHECK_PETER_KEY_HASH", hash(key));
    await expect(createSession(query, "wrong")).rejects.toMatchObject({
      status: 401,
    });
    const s = await createSession(query, key);
    await query(
      "UPDATE sc_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [hash(s.token)],
    );
    await expect(
      requireActor(
        new Request("https://app.example", {
          headers: { cookie: "shipcheck_session=" + s.token },
        }),
        query,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("denies anonymous live scans before any external call", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const response = await POST(
      new Request("http://localhost/api/scans", {
        method: "POST",
        body: JSON.stringify({
          mode: "live",
          filename: "package.json",
          content: '{"dependencies":{"lodash":"4.17.20"}}',
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
