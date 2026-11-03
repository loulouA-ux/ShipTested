import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { Store, type Actor } from "../src/lib/server/store";
import type { Query } from "../src/lib/server/db";
import { verifyProjectForScan } from "../src/lib/server/project-verification";
import { verifyDnsProof } from "../src/lib/host-verification";
vi.mock("../src/lib/host-verification", async (original) => ({
  ...await original<typeof import("../src/lib/host-verification")>(),
  verifyDnsProof: vi.fn(),
}));
const db = new PGlite();
const query: Query = async (sql, params = []) => (await db.query(sql, params)).rows as Record<string, unknown>[];
const store = new Store(query);
const actor: Actor = { id: "peter", workspaceId: "shipcheck-team", role: "member" };
beforeAll(async () => { await db.exec(readFileSync("migrations/001_core.sql", "utf8"));
for(const f of ['002_hosted_jobs','003_workspaces','004_team_sharing','009_batch_retry'])await db.exec(readFileSync(`migrations/${f}.sql`,'utf8')); });
afterAll(() => db.close());
it("rechecks proof on every scan and denies removed, changed or expired proof despite stored verification", async () => {
  const project = await store.createProject(actor, "Synthetic recheck", "https://proof.example.com");
  await store.markVerified(actor, project.id, project.challenge.token, "dns");
  vi.mocked(verifyDnsProof).mockResolvedValueOnce("verified");
  expect(await verifyProjectForScan(actor, project.id, store)).toMatchObject({ hostname: "proof.example.com" });
  for (const result of ["missing", "mismatch", "expired"] as const) {
    vi.mocked(verifyDnsProof).mockResolvedValueOnce(result);
    await expect(verifyProjectForScan(actor, project.id, store)).rejects.toMatchObject({ status: 409 });
  }
  expect(verifyDnsProof).toHaveBeenCalledTimes(4);
  const calls = vi.mocked(verifyDnsProof).mock.calls;
  expect(calls.every(([challenge]) => challenge.hostname === "proof.example.com" && challenge.token === project.challenge.token)).toBe(true);
  await expect(verifyProjectForScan({ ...actor, id: "louise" }, project.id, store)).rejects.toMatchObject({ status: 404 });
  expect(verifyDnsProof).toHaveBeenCalledTimes(4);
});
