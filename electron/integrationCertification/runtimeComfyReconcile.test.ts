import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const catalog = {
    version: 12,
    vendors: [{
      key: "comfyui-local",
      name: "Local ComfyUI",
      enabled: false,
      baseUrlHint: "http://127.0.0.1:8188",
      authType: "none",
      meta: { adapterCandidateRevisionId: "revision-1" },
    }],
    models: [{
      vendorKey: "comfyui-local",
      modelKey: "recovery-workflow",
      labelZh: "Recovery workflow",
      kind: "image",
      enabled: false,
      meta: { adapter: { state: "testing", runId: "revision-1" } },
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    }],
    mappings: [{
      id: "mapping-recovery",
      vendorKey: "comfyui-local",
      modelKey: "recovery-workflow",
      taskKind: "text_to_image",
      enabled: false,
      create: { method: "POST", path: "/prompt", body: {} },
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    }],
    apiKeysByVendor: {},
  };
  return { catalog, urls: [] as string[] };
});

vi.mock("../catalog/catalogStore", () => ({
  readCatalog: vi.fn(() => mocks.catalog),
  mutateCatalog: vi.fn(),
  extractVendorExtraHeaders: vi.fn(() => undefined),
  normalizeProviderKind: vi.fn((value: unknown) => String(value || "openai-compatible")),
}));

vi.mock("../hardenedFetch", () => ({
  isPrivateHost: vi.fn(() => true),
  hardenedFetch: vi.fn(async (url: string) => {
    mocks.urls.push(url);
    if (url.includes("/history/")) {
      return {
        bytes: Buffer.from(JSON.stringify({
          "opaque-prompt-42": {
            status: { status_str: "success", completed: true },
            outputs: { images: [{ filename: "recovered.png", subfolder: "", type: "output" }] },
          },
        })),
        contentType: "application/json",
      };
    }
    return { bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), contentType: "image/png" };
  }),
}));

vi.mock("../catalog/comfyuiCandidateLifecycle", () => ({
  resolveComfyStagedCandidate: vi.fn(() => ({
    revisionId: "revision-1",
    vendor: mocks.catalog.vendors[0],
    model: mocks.catalog.models[0],
    mapping: mocks.catalog.mappings[0],
    apiKey: "",
    customConfig: {},
  })),
  promoteCertifiedComfyCandidate: vi.fn(),
}));

import { createRuntimeIntegrationSessionService, IntegrationSessionService } from "./integrationSession";
import { OperationLedger } from "./operationLedger";
import { certificationModeOperationKey } from "./modeIdentity";

const WORKFLOW = JSON.stringify({
  "1": { class_type: "SaveImage", inputs: { filename_prefix: "recovery" } },
});

function sha(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("runtime ComfyUI reconciliation", () => {
  it("reconciles a submitted prompt through history/view after a fresh service boot without /prompt", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-runtime-comfy-reconcile-"));
    const sessionsFile = path.join(root, "sessions.json");
    const operationsFile = path.join(root, "operations.json");
    const save = (target: string, state: unknown) => fs.writeFileSync(target, JSON.stringify(state));
    const first = new IntegrationSessionService({ filePath: sessionsFile, save });
    const created = first.begin({
      kind: "comfyui-workflow",
      name: "Recovery workflow",
      baseUrl: "http://127.0.0.1:8188",
    }, "codex");
    const submitted = first.submitWorkflow(
      created.id,
      created.revision,
      "codex",
      WORKFLOW,
      { outputNodeId: "1", outputKind: "image" },
    );
    const ready = first.resolveInput(submitted.id, submitted.revision, "codex", {});
    const key = "runtime-recovery-idempotency";
    const persisted = JSON.parse(fs.readFileSync(sessionsFile, "utf8")) as { sessions: Array<Record<string, unknown>> };
    const rawSession = persisted.sessions[0];
    rawSession.stage = "certifying";
    rawSession.startIdempotencyKey = key;
    rawSession.startReceiptStatus = "consumed";
    rawSession.config = { ...(rawSession.config as Record<string, unknown>), modelKey: "recovery-workflow" };
    rawSession.configDigest = sha(rawSession.config);
    save(sessionsFile, persisted);

    const contractDigest = sha({
      kind: "comfyui-workflow",
      sessionId: created.id,
      configDigest: rawSession.configDigest,
      selections: [],
      idempotencyKey: key,
    });
    const runId = `integration-${created.id}-${sha(key).slice(0, 24)}`;
    const ledger = new OperationLedger(operationsFile);
    const begun = ledger.begin({
      runId,
      contractDigest,
      idempotencyKey: `${created.id}:${key}`,
      lineageRootVendorKey: "comfyui-local",
      sourceVendorKey: "comfyui-local",
      selectedModels: [],
      leaseOwner: "test",
      leaseToken: "lease-token",
      attempt: 1,
      childRunRef: { runId, revisionDigest: contractDigest },
      providerIdempotency: "unknown",
      now: "2026-08-28T00:00:00.000Z",
    });
    if (!begun.operation) throw new Error("operation was not created");
    const operationKey = certificationModeOperationKey("recovery-workflow", "text_to_image", 1);
    const submitting = ledger.markSubmitting(runId, {
      operationKey,
      modelKey: "recovery-workflow",
      taskKind: "text_to_image",
      attempt: 1,
      providerIdempotency: "unknown",
      expectedRevision: begun.operation.revision,
      now: "2026-08-28T00:00:01.000Z",
    });
    ledger.markSubmitted(runId, {
      operationKey,
      remoteTaskId: "opaque-prompt-42",
      expectedRevision: submitting.revision,
      now: "2026-08-28T00:00:02.000Z",
    });

    const certification = {
      analyzeComfyWorkflow: vi.fn(async () => ({ ok: true as const, analysis: { suggested: {} }, convertedText: WORKFLOW })),
      prepareComfyWorkflow: vi.fn(() => ({
        graph: {},
        imported: { kind: "image", taskKind: "text_to_image", templatedGraph: {}, parameters: [] },
        binding: { outputNodeId: "1", outputKind: "image" },
        mapping: {},
        model: {},
        parameters: [],
      })),
      reconcileComfyProduction: vi.fn(async (_prepared: unknown, promptId: string, deps: {
        readHistory: (id: string) => Promise<{ status: string; outputs?: Array<{ url: string; contentType: string }> }>;
        readView: (url: string) => Promise<unknown>;
        promote: (...args: unknown[]) => Promise<void> | void;
      }) => {
        const history = await deps.readHistory(promptId);
        expect(history.status).toBe("succeeded");
        const output = history.outputs?.[0];
        if (!output) throw new Error("history output missing");
        await deps.readView(output.url);
        await deps.promote([], { promptId, prepared: _prepared });
      }),
    };
    const restarted = createRuntimeIntegrationSessionService({
      filePath: sessionsFile,
      save,
      certification: certification as never,
      comfyOperationLedger: ledger,
    });

    const result = await restarted.start(ready.id, Number(rawSession.revision), "codex", key);
    expect(result.stage).toBe("completed");
    expect(certification.reconcileComfyProduction).toHaveBeenCalledTimes(1);
    expect(mocks.urls.some((url) => url.includes("/history/opaque-prompt-42"))).toBe(true);
    expect(mocks.urls.some((url) => url.includes("/view"))).toBe(true);
    expect(mocks.urls.some((url) => url.includes("/prompt"))).toBe(false);
    expect(ledger.getByIdempotencyKey(`${created.id}:${key}`)?.checkpoint).toBe("finalized");
  });
});
