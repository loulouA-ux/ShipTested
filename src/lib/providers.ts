import { brandEnv } from "./brand-env";
import { explain as coreExplain } from "@heysalad/shiptested/ai";
import type { Finding, Source } from "./types";
export { research, validateExplanations } from "@heysalad/shiptested/ai";
export { queryOsv } from "@heysalad/shiptested/osv";
export function explain(findings: Finding[], sources: Source[], key: string, fetcher: typeof fetch = fetch) {
  return coreExplain(findings, sources, key, fetcher, brandEnv("MODEL") || undefined);
}

export async function boundedJson(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
  maxBytes = 1_000_000,
): Promise<unknown> {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8_000_000)throw Error("Invalid provider response limit.");
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok) {await response.body?.cancel();throw new Error("Provider request failed.");}
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body?.cancel();throw new Error("Provider response too large.");
  }
  if (!response.body) throw new Error("Empty provider response.");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("Provider response too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
