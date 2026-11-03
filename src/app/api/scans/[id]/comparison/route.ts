import { database } from '@/lib/server/db';
import { requireApiActor } from '@/lib/server/api-tokens';
import { json, failure } from '@/lib/server/http';
import { refusePublicDemo } from '@/lib/server/public-demo';
import { validateScanId } from '@/lib/server/scan-id';
import { previousReportComparison } from '@/lib/server/report-comparison';
export const runtime = 'nodejs';
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  const denied = refusePublicDemo(); if (denied) return denied;
  try {
    const query = database(), actor = await requireApiActor(request, query);
    return json({comparison: await previousReportComparison(query, actor, validateScanId((await params).id))});
  } catch (error) { return failure(error); }
}
