import { describe, expect, it, vi } from "vitest";
import { ConnectionCertificationService } from "./service";
import type { CertificationContractBinding } from "./types";

const providerRun = {
  id: "adapter-run-1",
  vendorKey: "example",
  vendorName: "Example",
  selectedModelKeys: ["image-v1"],
  stage: "queued" as const,
  repairAttempt: 0,
  models: [],
  sourceUrls: [],
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

function connector() {
  return {
    configure: vi.fn(() => ({
      vendorKey: "example",
      vendorName: "Example",
      state: "configured" as const,
      selectedModelKeys: [],
      models: [],
      savedAt: "2026-08-28T00:00:00.000Z",
    })),
    start: vi.fn(async (_input: unknown) => providerRun),
    startExisting: vi.fn(async (_input: unknown) => ({ ok: true as const, run: providerRun })),
    retryExisting: vi.fn(),
    listExistingModels: vi.fn(),
    get: vi.fn(() => providerRun),
    latest: vi.fn(() => providerRun),
    cancel: vi.fn(() => ({ ...providerRun, stage: "cancelled" as const })),
    deleteRun: vi.fn(() => ({ ...providerRun, stage: "failed" as const })),
    list: vi.fn(() => [providerRun]),
    childRunRef: vi.fn(() => ({ runId: providerRun.id, revisionDigest: "a".repeat(64) })),
    resumeInterrupted: vi.fn(),
  };
}

const connection = {
  vendorName: "Example",
  baseUrl: "https://api.example.test/v1",
  apiKey: "secret",
  authType: "bearer" as const,
  providerKind: "openai-compatible" as const,
  models: [{ modelKey: "image-v1", labelZh: "Image V1", kind: "image" as const }],
};

describe("ConnectionCertificationService", () => {
  it("projects manual UI and programmatic starts into the same canonical run shape", async () => {
    const http = connector();
    const service = new ConnectionCertificationService({ http: http as never });

    const manual = await service.startHttp({
      entryPoint: "manual-ui",
      idempotencyKey: "same-confirmation",
      connection,
    });
    const programmatic = await service.startHttp({
      entryPoint: "programmatic-session",
      idempotencyKey: "same-confirmation",
      connection,
    });

    expect(Object.keys(manual).sort()).toEqual(Object.keys(programmatic).sort());
    expect(manual).toMatchObject({
      schemaVersion: 1,
      kind: "http-api-provider",
      id: "adapter-run-1",
      childRunRef: { runId: "adapter-run-1", revisionDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(http.start).toHaveBeenCalledTimes(2);
    const firstStart = http.start.mock.calls[0]![0] as { certification: unknown };
    const secondStart = http.start.mock.calls[1]![0] as { certification: unknown };
    expect(firstStart.certification).toEqual(secondStart.certification);
    expect(firstStart).not.toHaveProperty("entryPoint");
  });

  it("binds the real manual-existing and programmatic-new entry points to one immutable contract and canonical run", async () => {
    const http = connector();
    const byKey = new Map<string, typeof providerRun>();
    http.start.mockImplementation(async (input: unknown) => {
      const key = (input as { certification: CertificationContractBinding }).certification.idempotencyKey;
      const found = byKey.get(key) || providerRun;
      byKey.set(key, found);
      return found;
    });
    http.startExisting.mockImplementation(async (input: unknown) => {
      const key = (input as { certification: CertificationContractBinding }).certification.idempotencyKey;
      const found = byKey.get(key) || providerRun;
      byKey.set(key, found);
      return { ok: true as const, run: found };
    });
    const service = new ConnectionCertificationService({ http: http as never });

    const manual = await service.startExistingHttp({
      entryPoint: "manual-ui",
      idempotencyKey: "same-user-confirmation",
      vendorKey: "example",
      models: connection.models,
    });
    const programmatic = await service.startHttp({
      entryPoint: "programmatic-session",
      idempotencyKey: "same-user-confirmation",
      connection: { ...connection, catalogVendorKey: "example" },
    });

    expect(manual).toMatchObject({ ok: true, run: { id: providerRun.id } });
    expect(programmatic.id).toBe(providerRun.id);
    expect((http.startExisting.mock.calls[0]![0] as { certification: CertificationContractBinding }).certification)
      .toEqual((http.start.mock.calls[0]![0] as { certification: CertificationContractBinding }).certification);
  });

  it("preserves lineage, recovery and per-mode certification operations in the public run", () => {
    const completeRun = {
      ...providerRun,
      lineageRootVendorKey: "example-root",
      recovery: { reasonCode: "submission_unknown" as const, userAction: "reconcile_or_contact_provider" as const },
      certificationOperations: {
        mode: { operationKey: "a".repeat(64), submissionState: "unknown" as const },
      },
    };
    const http = connector();
    http.get.mockReturnValue(completeRun);
    const service = new ConnectionCertificationService({ http: http as never });

    expect(service.get(providerRun.id)).toMatchObject({
      lineageRootVendorKey: "example-root",
      recovery: { reasonCode: "submission_unknown" },
      certificationOperations: { mode: { submissionState: "unknown" } },
    });
  });

  it("binds execution-equivalent base URLs and model order to one idempotent contract", async () => {
    const http = connector();
    const service = new ConnectionCertificationService({ http: http as never });
    const secondModel = { modelKey: "video-v1", labelZh: "Video V1", kind: "video" as const };

    await service.startHttp({
      entryPoint: "manual-ui",
      idempotencyKey: "same-confirmation",
      connection: { ...connection, baseUrl: "https://api.example.test/v1/", models: [connection.models[0], secondModel] },
    });
    await service.startHttp({
      entryPoint: "programmatic-session",
      idempotencyKey: "same-confirmation",
      connection: { ...connection, baseUrl: "https://api.example.test/v1", models: [secondModel, connection.models[0]] },
    });

    const first = http.start.mock.calls[0]![0] as { certification: CertificationContractBinding };
    const second = http.start.mock.calls[1]![0] as { certification: CertificationContractBinding };
    expect(first.certification.contractDigest).toBe(second.certification.contractDigest);
  });

  it("keeps a connection-only save configured, unverified, and disabled", () => {
    const http = connector();
    const service = new ConnectionCertificationService({ http: http as never });

    const saved = service.configureHttpConnection({ ...connection, models: [] });

    expect(saved).toEqual(expect.objectContaining({ state: "configured", selectedModelKeys: [], models: [] }));
    expect(http.start).not.toHaveBeenCalled();
  });

  it("uses the connector as the only get, cancel, and list owner", () => {
    const http = connector();
    const service = new ConnectionCertificationService({ http: http as never });

    expect(service.get("adapter-run-1")).toMatchObject({ id: "adapter-run-1", kind: "http-api-provider" });
    expect(service.cancel("adapter-run-1")).toMatchObject({ id: "adapter-run-1", stage: "cancelled" });
    expect(service.deleteRun("adapter-run-1")).toMatchObject({ id: "adapter-run-1", stage: "failed" });
    expect(service.list({ activeOnly: true })).toHaveLength(1);
    expect(http.get).toHaveBeenCalledWith("adapter-run-1");
    expect(http.cancel).toHaveBeenCalledWith("adapter-run-1");
    expect(http.deleteRun).toHaveBeenCalledWith("adapter-run-1");
    expect(http.list).toHaveBeenCalledWith({ activeOnly: true });
  });
});
