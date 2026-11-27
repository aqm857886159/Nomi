import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasRunIdFor } from "../productionRun/canvasShotRunIndex";
import { envelopeRefFor } from "../productionRun/productionGenerationBinding";
import { SubmissionNotDispatchedError } from "../productionRun/submissionOutbox";
import { VendorRequestError } from "../vendor/vendorHttp";
import { isOpenGenerationRefusal } from "../shared/generationFailure";
import { createRunObservationDrivers } from "./appIntegrationRunObservation";
import { CANVAS_TEST_PROJECT as projectId, setupCanvasShots } from "./canvasShotTestUtils";
import type { CanvasTaskResult, CanvasTransport } from "./canvasTransportProvider";
import type { CanvasShotRequest } from "./appIntegrationCanvasShot";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const nodeId = "sample-node";
const url = (name: string) => `nomi-local://asset/${projectId}/assets/${name}`;
const paid: CanvasTaskResult = {
  id: "order-1", kind: "text_to_video", status: "succeeded",
  assets: [{ type: "video", url: url("shot.mp4"), durationSeconds: 4.25, width: 1920, height: 1080,
    thumbnailUrl: url("out.png"), previewState: "ready" }],
  provenance: { modelKey: "sample-model", timestamp: 12, params: { resolution: "1080p", seed: 91 },
    modeId: "sample-final", draftTaskId: "sample-42", cost: { amount: 8, currency: "credits", unit: "actual" } },
  raw: { layers: [{ name: "cloud", index: 0 }], receipt: "paid-output" },
};
const plain: CanvasShotRequest = { kind: paid.kind, prompt: "cloud", extras: { modelKey: "sample-model" } };
type Host = ReturnType<typeof setupCanvasShots>;

function fixture(result = paid) {
  // In-process provider endpoint. Both hosts share the upstream, only their Run files survive restart.
  const post = vi.fn(async (id: string): Promise<CanvasTaskResult> => ({
    id, kind: result.kind, status: "queued", assets: [], raw: {},
  }));
  const query = vi.fn((id: string) => ({ ...result, id }));
  const execute = vi.fn<CanvasTransport["execute"]>();
  const transport: CanvasTransport = {
    execute: execute.mockImplementation(() => post(`order-${post.mock.calls.length + 1}`)),
    fetchResult: async ({ taskId }) => ({ result: query(String(taskId)) }),
  };
  const host = setupCanvasShots({
    transport,
    observe: (submission, project, runId) => driver.observeSingleShotRun(
      submission as Parameters<typeof driver.observeSingleShotRun>[0], project, runId),
  });
  const driver: ReturnType<typeof createRunObservationDrivers> = createRunObservationDrivers({ repository: host.service.repository, buildSchedulerForRun: () => null });
  roots.push(host.root);
  for (const asset of result.assets) fs.writeFileSync(path.join(host.root, "assets", path.basename(asset.url)), "media");
  const restart = () => setupCanvasShots({ root: host.root, transport });
  const submit = (h: Host, runRecordId: string, request = { ...plain, kind: result.kind }, resendDecisionId?: string) =>
    h.runs.submit({ projectId, nodeId, runRecordId, vendor: "acme", request, senderId: h.senderId, gesture: h.gesture, resendDecisionId });
  const poll = (h: Host, runRecordId: string) => h.runs.poll({ projectId, runRecordId, senderId: h.senderId });
  const run = (id: string) => host.repository.read(projectId, canvasRunIdFor(id))!;
  const envelope = (id: string) => {
    const record = run(id);
    return JSON.parse(fs.readFileSync(path.join(host.root, envelopeRefFor(record.runId, record.jobs[0]!.jobId)), "utf8"));
  };
  return { host, restart, execute, post, query, submit, poll, run, envelope };
}

describe("paid canvas result recovery", () => {
  it.each(["online", "background"] as const)("returns the complete paid result after %s settlement and restart", async (route) => {
    const f = fixture();
    await f.submit(f.host, "first");
    if (route === "background") {
      f.host.runs.releaseSender(f.host.senderId);
      await vi.waitFor(() => expect(f.host.settled.map(entry => entry.runRecordId)).toEqual(["first"]));
    }
    const online = await f.poll(f.host, "first");
    expect(online).toEqual(paid);
    const fresh = f.restart();
    expect(await f.poll(fresh, "first")).toEqual(online);
    expect(await f.submit(fresh, "first")).toEqual(online);
    expect(f.envelope("first").settledResult).toEqual(online);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...paid, kind: "image_to_3d", assets: [{ type: "model3d", url: url("cloud.glb"), thumbnailUrl: url("out.png") }] },
    { ...paid, kind: "transcribe", assets: [], raw: { text: "blue cloud", segments: [{ start: 0, end: 2, text: "blue cloud" }] } },
  ])("completes and recovers $kind from the job", async (result) => {
    const f = fixture(result);
    // Whisper returns a terminal response in the submit call.
    if (result.kind === "transcribe") f.post.mockResolvedValueOnce(result);
    await f.submit(f.host, "first");
    await f.poll(f.host, "first");
    expect(f.run("first")).toMatchObject({ status: "completed", jobs: [{ status: "ready" }] });
    expect(f.run("first").artifacts.filter(a => a.jobId)).toHaveLength(result.assets.length);
    expect(await f.poll(f.restart(), "first")).toEqual(result);
    expect(f.post).toHaveBeenCalledTimes(1);
  });
});

describe.each(["draft_task_id", "source_task_id"])("paid derivation from %s", (source) => {
  const spec = { [source]: "sample-42", resolution: "1080p" };
  const first = { ...plain, params: spec };
  const next = { ...plain, extras: { ...plain.extras, ...spec, resolution: "720p", forceRerun: true } };

  it.each(["polling", "awaiting retrieval"])("attaches a fresh click while %s and polls the owner's result", async (state) => {
    const f = fixture();
    await f.submit(f.host, "first", first);
    f.query.mockReturnValueOnce(state === "polling"
      ? { ...paid, status: "running", assets: [] }
      : { ...paid, assets: [], raw: {} });
    await f.poll(f.host, "first");
    expect(f.run("first").jobs[0]).toMatchObject(state === "polling" ? { status: "polling" } : { errorCode: "output_retrieval_failed" });
    const fresh = f.restart();
    expect(await f.submit(fresh, "another", next)).toMatchObject({ id: "order-1" });
    expect(f.post).toHaveBeenCalledTimes(1);
    expect(await f.poll(f.restart(), "another")).toEqual(paid);
    expect(await f.poll(fresh, "first")).toEqual(paid);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it("requires the existing resend confirmation after success and moves the claim once", async () => {
    const f = fixture();
    await f.submit(f.host, "first", first);
    await f.poll(f.host, "first");
    const fresh = f.restart();
    // The renderer recognizes this submit refusal and calls decideResend(true) for the existing card.
    const refusal = await f.submit(fresh, "unconfirmed", next).catch((error: Error) => error);
    expect(refusal).toMatchObject({ action: "ask" });
    expect(isOpenGenerationRefusal((refusal as Error).message)).toBe(true);
    expect(f.post).toHaveBeenCalledTimes(1);
    const decision = fresh.runs.resend.decideResend({ projectId, nodeId, initiator: "user", senderId: fresh.senderId, resend: true });
    expect(decision.action).toBe("ask");
    if (decision.action !== "ask") throw new Error("missing confirmation");
    expect(await f.submit(fresh, "confirmed", next, decision.decisionId)).toMatchObject({ id: "order-2" });
    expect(await f.submit(fresh, "follow", next)).toMatchObject({ id: "order-2" });
    expect(f.post).toHaveBeenCalledTimes(2);
  });

  it.each(["provider_not_reached", "provider_rejected"])("replaces a %s owner and attaches to the replacement", async (errorCode) => {
    const f = fixture();
    const failure = errorCode === "provider_not_reached" ? new SubmissionNotDispatchedError("offline", "never_reached_network")
      : new VendorRequestError("policy refused", { vendorKey: "acme", method: "POST", url: "x", httpStatus: 400, upstreamMsg: "refused", category: "input", retryable: false },
        { httpStatus: 400, envelopeFailure: false, taskIdReturned: false });
    const notSent = errorCode === "provider_not_reached";
    (notSent ? f.execute : f.post).mockRejectedValueOnce(failure);
    await expect(f.submit(f.host, "first", first)).rejects.toThrow();
    expect(f.run("first").jobs[0]).toMatchObject({ errorCode });
    const fresh = f.restart();
    const count = notSent ? 1 : 2;
    const id = `order-${count}`;
    expect(await f.submit(fresh, "retry", next)).toMatchObject({ id });
    expect(await f.submit(fresh, "follow", next)).toMatchObject({ id });
    expect(await f.poll(fresh, "follow")).toEqual({ ...paid, id });
    expect(f.post).toHaveBeenCalledTimes(count);
  });
});

describe("settled canvas receipt boundaries", () => {
  it("replays a pre-snapshot job as media from both read doors", async () => {
    const f = fixture();
    await f.submit(f.host, "legacy");
    await f.poll(f.host, "legacy");
    const run = f.run("legacy");
    const file = path.join(f.host.root, envelopeRefFor(run.runId, run.jobs[0]!.jobId));
    const legacy = f.envelope("legacy");
    delete legacy.settledResult;
    fs.writeFileSync(file, JSON.stringify(legacy));
    const fresh = f.restart();
    const media = { id: paid.id, kind: paid.kind, status: "succeeded", assets: [{ type: "video", url: url("shot.mp4") }], raw: {} };
    expect(await f.poll(fresh, "legacy")).toEqual(media);
    expect(await f.submit(fresh, "legacy")).toEqual(media);
    expect(f.envelope("legacy")).not.toHaveProperty("settledResult");
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it("publishes the transcript snapshot before notifying the closed window", async () => {
    const result = { ...paid, kind: "transcribe", assets: [], raw: { text: "cloud", segments: [] } };
    const f = fixture(result);
    const receiptAtReady: unknown[] = [];
    const execute = f.host.service.repository.execute;
    vi.spyOn(f.host.service.repository, "execute").mockImplementation((project, id, command) => {
      const written = execute(project, id, command);
      if (command.type === "job.status" && command.payload.status === "ready") receiptAtReady.push(f.envelope("first").settledResult);
      return written;
    });
    await f.submit(f.host, "first");
    f.host.runs.releaseSender(f.host.senderId);
    await vi.waitFor(() => expect(f.host.settled).toHaveLength(1));
    expect(receiptAtReady).toEqual([result]);
    expect(f.run("first").status).toBe("completed");
    expect(await f.poll(f.restart(), "first")).toEqual(result);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: "text_to_video", raw: { text: "provider message" } },
    { kind: "transcribe", raw: { text: "  ", segments: [] } },
  ])("keeps empty $kind output retrievable without a false success", async ({ kind, raw }) => {
    const f = fixture({ ...paid, kind, assets: [], raw });
    await f.submit(f.host, "empty");
    expect(await f.poll(f.host, "empty")).toMatchObject({ status: "failed" });
    expect(f.run("empty").jobs[0]).toMatchObject({ errorCode: "output_retrieval_failed" });
    expect(f.envelope("empty")).not.toHaveProperty("settledResult");
  });

  it("coalesces simultaneous clicks during preparation", async () => {
    const f = fixture();
    const request = { ...plain, params: { draft_task_id: "draft", resolution: "1080p" } };
    const alias = { ...plain, extras: { ...plain.extras, source_task_id: " draft " }, params: { source_task_id: "stale" } };
    const [first, second] = await Promise.all([f.submit(f.host, "one", request), f.submit(f.host, "two", alias)]);
    expect(second).toEqual(first);
    expect(await f.poll(f.restart(), "two")).toEqual(paid);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it("can attach and poll while another host still awaits the provider handle", async () => {
    const f = fixture();
    let accept!: () => void;
    const waiting = new Promise<void>(resolve => { accept = resolve; });
    f.post.mockImplementationOnce(async id => {
      await waiting;
      return { id, kind: paid.kind, status: "queued", assets: [], raw: {} };
    });
    const request = { ...plain, params: { source_task_id: "original" } };
    const inFlight = f.submit(f.host, "first", request);
    try {
      await vi.waitFor(() => expect(f.post).toHaveBeenCalledTimes(1));
      const second = f.restart();
      expect(await f.submit(second, "another", request)).toMatchObject({ status: "queued" });
      expect(await f.poll(second, "another")).toMatchObject({ status: "running" });
    } finally { accept(); await inFlight; }
    expect(await f.poll(f.restart(), "another")).toEqual(paid);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it("binds confirmation to the exact completed source order", async () => {
    const f = fixture();
    const spec = (source: string) => ({ ...plain, params: { draft_task_id: source } });
    for (const id of ["draft-one", "draft-two"]) {
      await f.submit(f.host, id, spec(id));
      await f.poll(f.host, id);
    }
    await expect(f.submit(f.host, "third", spec("draft-one"))).rejects.toMatchObject({ action: "ask" });
    const token = f.host.resendDecisionFor(nodeId);
    await expect(f.submit(f.host, "wrong-order", spec("draft-two"), token)).rejects.toMatchObject({ action: "ask" });
    expect(f.post).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2])("checks every receipt after interruption landing the first of %i files", async (count) => {
    const result = { ...paid, assets: [paid.assets[0]!, { type: "video", url: url("second.mp4") }].slice(0, count) };
    const f = fixture(result);
    await f.submit(f.host, "first");
    const execute = f.host.service.repository.execute;
    let interrupted = false;
    vi.spyOn(f.host.service.repository, "execute").mockImplementation((project, id, command) => {
      const written = execute(project, id, command);
      if (command.type === "artifact.add" && !interrupted) {
        interrupted = true;
        throw new Error("interrupted after artifact.add");
      }
      return written;
    });
    const online = await f.poll(f.host, "first");
    if (count === 1) expect(online).toEqual(result);
    else expect(online).toMatchObject({ status: "running", assets: [] });
    await vi.waitFor(() => expect(f.run("first").status).toBe("completed"));
    expect(f.host.observed).toHaveLength(1);
    expect(await f.poll(f.restart(), "first")).toEqual(result);
    expect(f.post).toHaveBeenCalledTimes(1);
  });

  it("settles a persisted choices-only script transcript", async () => {
    const result = { ...paid, kind: "transcribe", assets: [], raw: {
      customCall: true, choices: [{ message: { role: "assistant", content: "blue cloud" } }],
    } };
    const f = fixture(result);
    f.post.mockResolvedValueOnce(result);
    await f.submit(f.host, "first");
    expect(await f.poll(f.restart(), "first")).toEqual(result);
    expect(f.run("first").status).toBe("completed");
    expect(f.post).toHaveBeenCalledTimes(1);
  });
});
