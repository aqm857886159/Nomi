import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ComfyUiConnector } from "./comfyuiConnector";
import { IntegrationSessionService } from "./integrationSession";
import { OperationLedger } from "./operationLedger";
import { certificationModeOperationKey } from "./modeIdentity";
import { CertificationMediaError } from "../providerAdapter/certificationMedia";
import { analyzeComfyWorkflowTextSmart } from "../catalog/comfyuiWorkflowImportStore";

const workflow = JSON.stringify({
  "1": { class_type: "LoadImage", inputs: { image: "first.png" } },
  "2": { class_type: "LoadImage", inputs: { image: "second.png" } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "{{request.prompt}}", clip: ["4", 0] } },
  "4": { class_type: "SaveImage", inputs: { image: ["3", 0], frame_rate: 24 } },
});
const validPng = fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.png"));

function sessionService(
  certifyComfy: (
    session: Parameters<NonNullable<NonNullable<ConstructorParameters<typeof IntegrationSessionService>[0]>["certifyComfy"]>>[0],
    key: string,
  ) => Promise<{ runId: string; revisionDigest: string }>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-comfy-session-integration-"));
  return new IntegrationSessionService({
    filePath: path.join(dir, "sessions.json"),
    save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    certifyComfy,
  });
}

function sha(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function recoverableComfySession(state: "submitted" | "unknown") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-comfy-session-recovery-"));
  const sessionsFile = path.join(dir, "sessions.json");
  const ledger = new OperationLedger(path.join(dir, "operations.json"));
  const save = (target: string, value: unknown) => fs.writeFileSync(target, JSON.stringify(value));
  const initial = new IntegrationSessionService({ filePath: sessionsFile, save });
  const created = initial.begin({ kind: "comfyui-workflow", name: "Recovery workflow" }, "codex");
  const withWorkflow = initial.submitWorkflow(created.id, created.revision, "codex", workflow);
  const ready = initial.resolveInput(withWorkflow.id, withWorkflow.revision, "codex", {});
  const key = "comfy-recovery-key";
  const raw = JSON.parse(fs.readFileSync(sessionsFile, "utf8")) as { sessions: Array<Record<string, unknown>> };
  const session = raw.sessions[0];
  const contractDigest = sha({
    kind: "comfyui-workflow",
    sessionId: created.id,
    configDigest: session.configDigest,
    selections: [],
    idempotencyKey: key,
  });
  const runId = `integration-${created.id}-${sha(key).slice(0, 24)}`;
  const operation = ledger.begin({
    runId,
    contractDigest,
    idempotencyKey: `${created.id}:${key}`,
    lineageRootVendorKey: "comfyui-local",
    sourceVendorKey: "comfyui-local",
    selectedModels: [],
    leaseOwner: "test",
    leaseToken: "lease",
    attempt: 1,
    childRunRef: { runId, revisionDigest: contractDigest },
    providerIdempotency: "unknown",
    now: "2026-08-28T00:00:00.000Z",
  });
  if (!operation.operation) throw new Error("ledger operation was not created");
  const operationKey = certificationModeOperationKey("recovery-workflow", "text_to_image", 1);
  let persisted = ledger.markSubmitting(runId, {
    operationKey,
    modelKey: "recovery-workflow",
    taskKind: "text_to_image",
    attempt: 1,
    providerIdempotency: "unknown",
    expectedRevision: operation.operation.revision,
    now: "2026-08-28T00:00:01.000Z",
  });
  persisted = ledger.markSubmitted(runId, {
    operationKey,
    remoteTaskId: "opaque-prompt-42",
    expectedRevision: persisted.revision,
    now: "2026-08-28T00:00:02.000Z",
  });
  if (state === "unknown") {
    ledger.markUnknown(runId, {
      operationKey,
      expectedRevision: persisted.revision,
      userAction: "reconcile_or_contact_provider",
      remoteTaskId: "opaque-prompt-42",
      now: "2026-08-28T00:00:03.000Z",
    });
  }
  session.stage = "certifying";
  session.startIdempotencyKey = key;
  session.startReceiptStatus = "consumed";
  session.pendingReceiptId = "opaque-receipt";
  fs.writeFileSync(sessionsFile, JSON.stringify(raw));
  return { sessionsFile, ledger, id: ready.id, revision: Number(session.revision), key, save };
}

describe("ComfyUI canonical integration session", () => {
  it("runs submit -> resolve -> confirmation -> start with UI conversion, two uploads, numeric frame_rate, and one prompt", async () => {
    const connector = new ComfyUiConnector({
      analyzeSmart: vi.fn(async () => ({
        ok: true as const,
        analysis: { suggested: { images: [] } },
        convertedText: workflow,
        sourceWorkflowText: "ui-save-workflow",
      })) as unknown as typeof analyzeComfyWorkflowTextSmart,
    });
    const events: string[] = [];
    const promote = vi.fn();
    const certifyComfy = vi.fn(async (session, key) => {
      const converted = await connector.analyze(session.config.workflow, "comfyui-local");
      if (!converted.ok || !converted.convertedText) throw new Error("ui conversion failed");
      const prepared = connector.prepareWorkflow({
        workflowText: converted.convertedText,
        binding: {
          images: [
            { nodeId: "1", inputKey: "image", paramKey: "comfy_a", label: "A", mediaKind: "image" },
            { nodeId: "2", inputKey: "image", paramKey: "comfy_b", label: "B", mediaKind: "image" },
          ],
          outputNodeId: "4",
          outputKind: "image",
          params: [{ nodeId: "4", inputKey: "frame_rate", paramKey: "comfy_frame_rate", label: "FPS", type: "number", default: 24 }],
        },
      });
      const run = await connector.runProduction(prepared, {
        media: {
          comfy_a: { bytes: new Uint8Array([1]), contentType: "image/png" },
          comfy_b: { bytes: new Uint8Array([2]), contentType: "image/png" },
        },
        params: { comfy_frame_rate: 30 },
        uploadMedia: async (slot) => { events.push(`upload:${slot.paramKey}`); return `${slot.paramKey}.png`; },
        submitPrompt: async (request) => {
          events.push("prompt");
          expect((request.prompt["1"] as { inputs: Record<string, unknown> }).inputs.image).toBe("comfy_a.png");
          expect((request.prompt["2"] as { inputs: Record<string, unknown> }).inputs.image).toBe("comfy_b.png");
          expect((request.prompt["4"] as { inputs: Record<string, unknown> }).inputs.frame_rate).toBe(30);
          expect(typeof (request.prompt["4"] as { inputs: Record<string, unknown> }).inputs.frame_rate).toBe("number");
          return { promptId: `prompt-${key}` };
        },
        readHistory: async () => { events.push("history"); return { status: "succeeded", outputs: [{ url: "http://comfy/view/result.png", contentType: "image/png" }] }; },
        readView: async () => { events.push("view"); return { bytes: validPng, contentType: "image/png" }; },
        decodeImage: async () => { events.push("decode"); return { mimeType: "image/png", width: 1, height: 1 }; },
        expectedKind: "image",
        promote: async (evidence) => { events.push("promote"); promote(evidence); },
      });
      return { runId: run.promptId, revisionDigest: "a".repeat(64) };
    });
    const service = sessionService(certifyComfy);
    const created = service.begin({ kind: "comfyui-workflow", name: "UI workflow" }, "codex");
    const submitted = service.submitWorkflow(created.id, created.revision, "codex", "ui-save-workflow");
    const ready = service.resolveInput(submitted.id, submitted.revision, "codex", {});
    const first = await service.start(ready.id, ready.revision, "codex", "comfy-idempotency", "receipt");
    expect(first.stage).toBe("completed");
    expect(first.childRunRef?.runId).toBe("prompt-comfy-idempotency");
    expect(events).toEqual(["upload:comfy_a", "upload:comfy_b", "prompt", "history", "view", "decode", "promote"]);
    expect(promote).toHaveBeenCalledTimes(1);
    expect(certifyComfy).toHaveBeenCalledTimes(1);

    const replay = await service.start(first.id, first.revision, "codex", "comfy-idempotency", "receipt");
    expect(replay.childRunRef).toEqual(first.childRunRef);
    expect(certifyComfy).toHaveBeenCalledTimes(1);
  });

  it("keeps the session failed and never promotes when /view decoding rejects the artifact", async () => {
    const promote = vi.fn();
    const connector = new ComfyUiConnector();
    const certifyComfy = vi.fn(async () => {
      const prepared = connector.prepareWorkflow({ workflowText: workflow, binding: { outputNodeId: "4", outputKind: "image" } });
      await connector.runProduction(prepared, {
        media: {},
        submitPrompt: async () => ({ promptId: "failed-prompt" }),
        readHistory: async () => ({ status: "succeeded", outputs: [{ url: "http://comfy/view/error", contentType: "text/html" }] }),
        readView: async () => ({ bytes: new Uint8Array([60, 104, 116, 109, 108, 62]), contentType: "text/html" }),
        promote,
      });
      return { runId: "never", revisionDigest: "b".repeat(64) };
    });
    const service = sessionService(certifyComfy);
    const created = service.begin({ kind: "comfyui-workflow", name: "Broken workflow" }, "codex");
    const submitted = service.submitWorkflow(created.id, created.revision, "codex", workflow);
    const ready = service.resolveInput(submitted.id, submitted.revision, "codex", {});
    const result = await service.start(ready.id, ready.revision, "codex", "failed-idempotency", "receipt");
    expect(result.stage).toBe("failed");
    expect(result.childRunRef).toBeUndefined();
    expect(result.blockingReason?.code).toBe("provider_failed");
    expect(promote).not.toHaveBeenCalled();
    expect(certifyComfy).toHaveBeenCalledTimes(1);
    await expect(Promise.reject(new CertificationMediaError("media_markup_masquerade"))).rejects.toBeInstanceOf(CertificationMediaError);
    // No promotion callback means a failed certification cannot replace an
    // existing active revision; the canonical Catalog writer is never reached.
    expect(promote).not.toHaveBeenCalled();
  });

  it("recovers a durable submitted prompt after restart through the injected history reconciler without a second create", async () => {
    const fixture = recoverableComfySession("submitted");
    const reconcileComfy = vi.fn(async () => {});
    const certifyComfy = vi.fn(async () => ({ runId: "must-not-create", revisionDigest: "d".repeat(64) }));
    const restarted = new IntegrationSessionService({
      filePath: fixture.sessionsFile,
      save: fixture.save,
      comfyOperationLedger: fixture.ledger,
      reconcileComfy,
      certifyComfy,
    });

    const result = await restarted.start(fixture.id, fixture.revision, "codex", fixture.key);
    expect(result.stage).toBe("completed");
    expect(result.childRunRef?.runId).toContain(`integration-${fixture.id}`);
    expect(reconcileComfy).toHaveBeenCalledWith(expect.objectContaining({ id: fixture.id }), fixture.key, "opaque-prompt-42");
    expect(certifyComfy).not.toHaveBeenCalled();
    expect(fixture.ledger.getByIdempotencyKey(`${fixture.id}:${fixture.key}`)?.checkpoint).toBe("finalized");

    const replay = await restarted.start(result.id, result.revision, "codex", fixture.key);
    expect(replay.stage).toBe("completed");
    expect(reconcileComfy).toHaveBeenCalledTimes(1);
    expect(certifyComfy).not.toHaveBeenCalled();
  });

  it("reconciles an unknown prompt id once and never invokes the normal certification create callback", async () => {
    const fixture = recoverableComfySession("unknown");
    const reconcileComfy = vi.fn(async () => {});
    const certifyComfy = vi.fn(async () => ({ runId: "must-not-create", revisionDigest: "e".repeat(64) }));
    const restarted = new IntegrationSessionService({
      filePath: fixture.sessionsFile,
      save: fixture.save,
      comfyOperationLedger: fixture.ledger,
      reconcileComfy,
      certifyComfy,
    });

    await expect(restarted.start(fixture.id, fixture.revision, "codex", fixture.key)).resolves.toMatchObject({ stage: "completed" });
    expect(reconcileComfy).toHaveBeenCalledTimes(1);
    expect(certifyComfy).not.toHaveBeenCalled();
    const recovered = fixture.ledger.getByIdempotencyKey(`${fixture.id}:${fixture.key}`);
    expect(recovered?.submissionState).toBe("settled");
    expect(recovered?.checkpoint).toBe("finalized");
  });
});
