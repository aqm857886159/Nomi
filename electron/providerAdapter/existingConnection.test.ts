import { describe, expect, it, vi } from "vitest";
import type { CatalogState, Model, Vendor } from "../catalog/types";
import {
  createExistingConnectionActions,
  type ExistingConnectionActionsDependencies,
  type ExistingConnectionAdapterStartInput,
} from "./existingConnection";

const SECRET = "sk-never-leaves-main";
const CERTIFICATION = {
  contractDigest: "a".repeat(64),
  idempotencyKey: "manual-confirm-1",
  remoteIdempotency: "unknown" as const,
};

function vendor(patch: Partial<Vendor> = {}): Vendor {
  return {
    key: "my-private-relay",
    name: "My private relay",
    enabled: true,
    hasApiKey: true,
    baseUrlHint: "https://gateway.example.test/v1",
    authType: "bearer",
    providerKind: "openai-compatible",
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...patch,
  };
}

function model(modelKey: string, kind: Model["kind"] = "text"): Model {
  return {
    vendorKey: "my-private-relay",
    modelKey,
    labelZh: modelKey,
    kind,
    enabled: true,
    meta: { adapter: { state: "verified", activeRevision: "rev-1", modes: [{ taskKind: kind === "image" ? "text_to_image" : "chat", state: "verified" }] } },
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  };
}

function catalog(patch: Partial<CatalogState> = {}): CatalogState {
  return {
    version: 8,
    vendors: [vendor()],
    models: [model("already-there", "image")],
    mappings: [],
    apiKeysByVendor: {
      "my-private-relay": {
        vendorKey: "my-private-relay",
        apiKey: "encrypted-on-disk",
        enabled: true,
        enc: "safeStorage",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
      },
    },
    ...patch,
  } as CatalogState;
}

function harness(state = catalog()) {
  const fetchModels = vi.fn<ExistingConnectionActionsDependencies["fetchModels"]>(async () => ({
    ok: true as const,
    models: ["already-there", "new-video"],
    statuses: [200],
  }));
  const startAdapter = vi.fn<ExistingConnectionActionsDependencies["startAdapter"]>(async (input: ExistingConnectionAdapterStartInput) => ({
    id: "run-1",
    vendorKey: input.vendorKey,
    vendorName: input.vendorName,
    selectedModelKeys: input.models.map((item) => item.modelKey),
    stage: "queued" as const,
    repairAttempt: 0,
    models: [],
    sourceUrls: [],
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    connectionFingerprint: "fingerprint",
  }));
  const actions = createExistingConnectionActions({
    readCatalog: () => state,
    decryptApiKey: () => SECRET,
    fetchModels,
    startAdapter,
    getAdapterRun: () => undefined,
  });
  return { actions, fetchModels, startAdapter };
}

describe("existing connection model discovery", () => {
  it("uses the stored credential in main but only returns public connection data", async () => {
    const { actions, fetchModels } = harness();

    const result = await actions.listModels({ vendorKey: "my-private-relay" });

    expect(result).toEqual({
      ok: true,
      connection: {
        vendorKey: "my-private-relay",
        vendorName: "My private relay",
        baseUrl: "https://gateway.example.test/v1",
        existingModels: [{ modelKey: "already-there", labelZh: "already-there", kind: "image" }],
      },
      models: ["already-there", "new-video"],
    });
    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: SECRET }));
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("keeps manual model-id entry available when the endpoint cannot list models", async () => {
    const { actions, fetchModels } = harness();
    fetchModels.mockResolvedValueOnce({ ok: false, error: "HTTP 404", statuses: [404, 404] });

    const result = await actions.listModels({ vendorKey: "my-private-relay" });

    expect(result).toMatchObject({
      ok: false,
      code: "MODEL_LIST_UNAVAILABLE",
      connection: { vendorKey: "my-private-relay" },
      error: "HTTP 404",
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("redacts a query credential even when a network error echoes its URL", async () => {
    const { actions, fetchModels } = harness();
    fetchModels.mockResolvedValueOnce({
      ok: false,
      error: `request failed: https://api.test/models?api_key=${encodeURIComponent(SECRET)}`,
      statuses: [],
    });

    const result = await actions.listModels({ vendorKey: "my-private-relay" });

    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).toMatchObject({ error: expect.stringContaining("[REDACTED]") });
  });

  it("does not mark an unverified seed as already added, leaving it selectable for certification", async () => {
    const staged = {
      ...model("deepseek-v4-pro"),
      meta: { adapter: { state: "unverified", modes: [] } },
    };
    const { actions } = harness(catalog({ models: [staged] }));

    const result = await actions.listModels({ vendorKey: "my-private-relay" });

    expect(result).toMatchObject({
      ok: true,
      connection: { existingModels: [] },
      models: ["already-there", "new-video"],
    });
  });

  it("reports a recoverable credential action without trying the network", async () => {
    const { fetchModels } = harness();
    const missingCredential = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey: () => "",
      fetchModels,
      startAdapter: vi.fn(async () => { throw new Error("startAdapter must not run"); }),
      getAdapterRun: () => undefined,
    });

    const result = await missingCredential.listModels({ vendorKey: "my-private-relay" });

    expect(result).toMatchObject({ ok: false, code: "CREDENTIAL_MISSING" });
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("forwards discovery failure classification and real HTTP status to the renderer", async () => {
    const { actions, fetchModels } = harness();
    fetchModels.mockResolvedValueOnce({ ok: false, error: "expired key", status: 200, statuses: [200], failureKind: "auth" });
    expect(await actions.listModels({ vendorKey: "my-private-relay" }))
      .toMatchObject({ ok: false, code: "MODEL_LIST_UNAVAILABLE", failureKind: "auth", status: 200, error: "expired key" });
  });

  it("forwards partial success rather than presenting a budget-limited list as complete", async () => {
    const { actions, fetchModels } = harness();
    fetchModels.mockResolvedValueOnce({ ok: true, models: ["new-video"], statuses: [200], partial: true });
    expect(await actions.listModels({ vendorKey: "my-private-relay" }))
      .toMatchObject({ ok: true, models: ["new-video"], partial: true });
  });

  it("keeps base/query/header credentials in main even when a rejected fetch echoes them", async () => {
    const baseUrl = "https://gateway.example.test/v1?tenant_secret=base-secret";
    const { actions, fetchModels } = harness(catalog({
      vendors: [vendor({ baseUrlHint: baseUrl, meta: { extraHeaders: { "X-Private": "header-secret" } } })],
    }));
    fetchModels.mockRejectedValueOnce(new Error(`${baseUrl} ${SECRET} header-secret base-secret`));
    const result = await actions.listModels({ vendorKey: "my-private-relay" });
    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({ baseUrl }));
    expect(result).toMatchObject({ ok: false, failureKind: "network" });
    const output = JSON.stringify(result);
    for (const secret of [SECRET, "header-secret", "base-secret", "tenant_secret="]) expect(output).not.toContain(secret);
  });
});

describe("existing connection canonical certification", () => {
  it("certifies saved models using catalog-owned model metadata", async () => {
    const { actions, startAdapter } = harness();

    const result = await actions.start({
      vendorKey: "my-private-relay",
      models: [{ modelKey: "already-there", labelZh: "Renderer override", kind: "text" }],
      certification: CERTIFICATION,
    });

    expect(result).toMatchObject({ ok: true, run: { selectedModelKeys: ["already-there"] } });
    expect(startAdapter).toHaveBeenCalledWith(expect.objectContaining({
      vendorKey: "my-private-relay",
      apiKey: SECRET,
      models: [{ modelKey: "already-there", labelZh: "already-there", kind: "image" }],
      certification: CERTIFICATION,
    }));
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("existing connection adapter start", () => {
  it("preserves an arbitrary catalog vendor key and certifies every selected model", async () => {
    const { actions, startAdapter } = harness();

    const result = await actions.start({
      vendorKey: "my-private-relay",
      models: [
        { modelKey: "already-there", labelZh: "Existing", kind: "image" },
        { modelKey: "new-video", labelZh: "New video", kind: "video" },
      ],
      certification: CERTIFICATION,
    });

    expect(result).toMatchObject({
      ok: true,
      run: { vendorKey: "my-private-relay", selectedModelKeys: ["already-there", "new-video"] },
    });
    expect(startAdapter).toHaveBeenCalledWith(expect.objectContaining({
      vendorKey: "my-private-relay",
      apiKey: SECRET,
      models: [
        { modelKey: "already-there", labelZh: "already-there", kind: "image" },
        { modelKey: "new-video", labelZh: "New video", kind: "video" },
      ],
      certification: CERTIFICATION,
    }));
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("allows recertifying a model that already exists in the catalog", async () => {
    const { actions, startAdapter } = harness();

    const result = await actions.start({
      vendorKey: "my-private-relay",
      models: [{ modelKey: "already-there", kind: "image" }],
      certification: CERTIFICATION,
    });

    expect(result).toMatchObject({ ok: true, run: { selectedModelKeys: ["already-there"] } });
    expect(startAdapter).toHaveBeenCalledTimes(1);
  });

  it("redacts a credential if an adapter error unexpectedly echoes it", async () => {
    const { actions, startAdapter } = harness();
    startAdapter.mockImplementationOnce(async (input) => ({
      id: "run-secret-echo",
      vendorKey: input.vendorKey,
      vendorName: input.vendorName,
      selectedModelKeys: ["new-video"],
      stage: "failed",
      repairAttempt: 0,
      models: [],
      sourceUrls: [],
      error: `upstream echoed ${SECRET}`,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      connectionFingerprint: "fingerprint",
    }));

    const result = await actions.start({
      vendorKey: "my-private-relay",
      models: [{ modelKey: "new-video", kind: "video" }],
      certification: CERTIFICATION,
    });

    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).toMatchObject({ ok: true, run: { error: "upstream echoed [REDACTED]" } });
  });

  it("allows an auth-free stored connection without inventing a credential", async () => {
    const authFree = catalog({
      vendors: [vendor({ authType: "none", hasApiKey: false })],
      apiKeysByVendor: {},
      models: [],
    });
    const { actions, startAdapter } = harness(authFree);

    const result = await actions.start({
      vendorKey: "my-private-relay",
      models: [{ modelKey: "local-model", kind: "text" }],
      certification: CERTIFICATION,
    });

    expect(result.ok).toBe(true);
    expect(startAdapter).toHaveBeenCalledWith(expect.objectContaining({ authType: "none", apiKey: "" }));
  });
});

describe("persisted provider adapter retry", () => {
  const previousRun = {
    id: "run-failed",
    vendorKey: "my-private-relay",
    vendorName: "Old display name",
    selectedModelKeys: ["already-there", "missing-from-catalog"],
    stage: "failed" as const,
    repairAttempt: 0,
    models: [
      { modelKey: "already-there", labelZh: "Existing image", kind: "image" as const, modes: [] },
      { modelKey: "missing-from-catalog", labelZh: "Recovered video", kind: "video" as const, modes: [] },
    ],
    sourceUrls: [],
    error: `old upstream echo ${SECRET}`,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:01:00.000Z",
    connectionFingerprint: "old-fingerprint",
  };

  it.each(["cancelled", "timed_out", "failed", "partial"] as const)(
    "starts a new run for a persisted %s task without filtering already-catalogued models",
    async (stage) => {
      const { startAdapter } = harness();
      const actions = createExistingConnectionActions({
        readCatalog: () => catalog(),
        decryptApiKey: () => SECRET,
        fetchModels: vi.fn(),
        startAdapter,
        getAdapterRun: () => ({ ...previousRun, stage }),
      });

      const result = await actions.retry({ runId: previousRun.id, certification: CERTIFICATION });

      expect(result).toMatchObject({
        ok: true,
        run: {
          vendorKey: "my-private-relay",
          selectedModelKeys: ["already-there", "missing-from-catalog"],
        },
      });
      expect(startAdapter).toHaveBeenCalledWith(expect.objectContaining({
        vendorKey: "my-private-relay",
        apiKey: SECRET,
        models: [
          { modelKey: "already-there", labelZh: "Existing image", kind: "image" },
          { modelKey: "missing-from-catalog", labelZh: "Recovered video", kind: "video" },
        ],
        certification: CERTIFICATION,
      }));
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain("connectionFingerprint");
    },
  );

  it("starts a new run for only the requested persisted model", async () => {
    const { startAdapter } = harness();
    const actions = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey: () => SECRET,
      fetchModels: vi.fn(),
      startAdapter,
      getAdapterRun: () => previousRun,
    });

    const result = await actions.retry({
      runId: previousRun.id,
      modelKey: "missing-from-catalog",
      certification: CERTIFICATION,
    });

    expect(result).toMatchObject({
      ok: true,
      run: { selectedModelKeys: ["missing-from-catalog"] },
    });
    expect(startAdapter).toHaveBeenCalledWith(expect.objectContaining({
      models: [{ modelKey: "missing-from-catalog", labelZh: "Recovered video", kind: "video" }],
    }));
  });

  it("rejects a model-specific retry outside the persisted task", async () => {
    const { startAdapter } = harness();
    const actions = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey: () => SECRET,
      fetchModels: vi.fn(),
      startAdapter,
      getAdapterRun: () => previousRun,
    });

    const result = await actions.retry({
      runId: previousRun.id,
      modelKey: "renderer-injected-model",
      certification: CERTIFICATION,
    });

    expect(result).toMatchObject({ ok: false, code: "RUN_MODELS_MISSING" });
    expect(startAdapter).not.toHaveBeenCalled();
  });

  it("rejects an active task before reading its saved credential", async () => {
    const decryptApiKey = vi.fn(() => SECRET);
    const startAdapter = vi.fn(async () => { throw new Error("startAdapter must not run"); });
    const actions = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey,
      fetchModels: vi.fn(),
      startAdapter,
      getAdapterRun: () => ({ ...previousRun, stage: "testing" }),
    });

    const result = await actions.retry({ runId: previousRun.id, certification: CERTIFICATION });

    expect(result).toMatchObject({ ok: false, code: "RUN_ACTIVE" });
    expect(decryptApiKey).not.toHaveBeenCalled();
    expect(startAdapter).not.toHaveBeenCalled();
  });

  it("rejects an unknown task without consulting renderer-supplied connection data", async () => {
    const startAdapter = vi.fn(async () => { throw new Error("startAdapter must not run"); });
    const actions = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey: () => SECRET,
      fetchModels: vi.fn(),
      startAdapter,
      getAdapterRun: () => undefined,
    });

    const result = await actions.retry({ runId: "missing", certification: CERTIFICATION });

    expect(result).toMatchObject({ ok: false, code: "RUN_NOT_FOUND" });
    expect(startAdapter).not.toHaveBeenCalled();
  });
});
