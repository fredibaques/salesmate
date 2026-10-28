import { describe, expect, it } from "vitest";
import { sendToWorker } from "./dispatch";
import { parseJob, type Job } from "./jobs";

const job: Job = {
  kind: "prospecting",
  orgId: "org-1",
  agentId: "agent-1",
  triggerRef: "user-1",
  wanted: 20,
};
const worker = { url: "https://worker.example/", secret: "s".repeat(40) };

function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("handing jobs to the worker", () => {
  it("sends the job with the shared secret and counts it taken on 202", async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 202 }));
    expect(await sendToWorker(job, { ...worker, fetch })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(worker.url);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${worker.secret}`);
    expect(parseJob(JSON.parse(calls[0].init.body as string))).toEqual(job);
  });

  it("keeps the job here when there is no worker, it refuses it or can't be reached", async () => {
    const refused = fakeFetch(() => new Response("unauthorized", { status: 401 }));
    const down = fakeFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await sendToWorker(job, { url: "", secret: "", fetch: refused.fetch })).toBe(false);
    expect(refused.calls).toHaveLength(0);
    expect(await sendToWorker(job, { ...worker, fetch: refused.fetch })).toBe(false);
    expect(await sendToWorker(job, { ...worker, fetch: down.fetch })).toBe(false);
  });

  it("only takes jobs it knows", () => {
    expect(parseJob({ kind: "cron", name: "agents" })).toEqual({ kind: "cron", name: "agents" });
    expect(parseJob({ kind: "cron", name: "drop-tables" })).toBeNull();
    expect(parseJob({ kind: "outreach", agentId: "a" })).toBeNull();
    expect(parseJob({ kind: "shell", command: "rm -rf /" })).toBeNull();
    expect(parseJob("outreach")).toBeNull();
  });
});
