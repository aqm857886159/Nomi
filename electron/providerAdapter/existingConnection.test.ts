import { describe, expect, it, vi } from "vitest";
import type { CatalogState, Model, Vendor } from "../catalog/types";
import {
  createExistingConnectionActions,
  type ExistingConnectionAdapterRegisterInput,
  type ExistingConnectionAdapterStartInput,
} from "./existingConnection";

const SECRET = "sk-never-leaves-main";

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
  const fetchModels = vi.fn(async () => ({
    ok: true as const,
    models: ["already-there", "new-video"],
    statuses: [200],
  }));
  const startAdapter = vi.fn((input: ExistingConnectionAdapterStartInput) => ({
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
  const registerAdapter = vi.fn((input: ExistingConnectionAdapterRegisterInput) => ({
    vendorKey: input.vendorKey,
    vendorName: input.vendorName,
    state: "configured" as const,
    selectedModelKeys: input.models.map((item: { modelKey: string }) => item.modelKey),
    models: input.models.map((item: { modelKey: string; labelZh?: string; kind: Model["kind"] }) => ({
      ...item,
      state: "unverified" as const,
    })),
    savedAt: "2026-08-15T00:00:00.000Z",
  }));
  const actions = createExistingConnectionActions({
    readCatalog: () => state,
    decryptApiKey: () => SECRET,
    fetchModels,
    registerAdapter,
    startAdapter,
    getAdapterRun: () => undefined,
  });
  return { actions, fetchModels, registerAdapter, startAdapter };
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

  it("reports a recoverable credential action without trying the network", async () => {
    const { fetchModels } = harness();
    const missingCredential = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey: () => "",
      fetchModels,
      registerAdapter: vi.fn(),
      startAdapter: vi.fn(),
      getAdapterRun: () => undefined,
    });

    const result = await missingCredential.listModels({ vendorKey: "my-private-relay" });

    expect(result).toMatchObject({ ok: false, code: "CREDENTIAL_MISSING" });
    expect(fetchModels).not.toHaveBeenCalled();
  });
});

describe("existing connection save-first registration", () => {
  it("adds only new models without exposing or passing the saved credential", async () => {
    const { actions, registerAdapter, startAdapter } = harness();

    const result = await actions.register({
      vendorKey: "my-private-relay",
      models: [
        { modelKey: "already-there", kind: "image" },
        { modelKey: "new-video", labelZh: "New video", kind: "video" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      registration: {
        vendorKey: "my-private-relay",
        state: "configured",
        selectedModelKeys: ["new-video"],
        models: [{ modelKey: "new-video", state: "unverified" }],
      },
    });
    expect(registerAdapter).toHaveBeenCalledWith(expect.objectContaining({
      vendorKey: "my-private-relay",
      models: [{ modelKey: "new-video", labelZh: "New video", kind: "video" }],
    }));
    expect(registerAdapter.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
    expect(startAdapter).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("starts explicit adaptation for saved models using catalog-owned model metadata", async () => {
    const { actions, startAdapter } = harness();

    const result = await actions.adapt({
      vendorKey: "my-private-relay",
      models: [{ modelKey: "already-there", labelZh: "Renderer override", kind: "text" }],
    });

    expect(result).toMatchObject({ ok: true, run: { selectedModelKeys: ["already-there"] } });
    expect(startAdapter).toHaveBeenCalledWith(expect.objectContaining({
      vendorKey: "my-private-relay",
      apiKey: SECRET,
      models: [{ modelKey: "already-there", labelZh: "already-there", kind: "image" }],
    }));
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("existing connection adapter start", () => {
  it("preserves an arbitrary catalog vendor key and starts only newly selected models", async () => {
    const { actions, startAdapter } = harness();

    const result = await actions.start({
      vendorKey: "my-private-relay",
      models: [
        { modelKey: "already-there", labelZh: "Existing", kind: "image" },
        { modelKey: "new-video", labelZh: "New video", kind: "video" },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      run: { vendorKey: "my-private-relay", selectedModelKeys: ["new-video"] },
    });
    expect(startAdapter).toHaveBeenCalledWith(expect.objectContaining({
      vendorKey: "my-private-relay",
      apiKey: SECRET,
      models: [{ modelKey: "new-video", labelZh: "New video", kind: "video" }],
    }));
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("does not reconfigure the connection when every selection already exists", async () => {
    const { actions, startAdapter } = harness();

    const result = await actions.start({
      vendorKey: "my-private-relay",
      models: [{ modelKey: "already-there", kind: "image" }],
    });

    expect(result).toMatchObject({ ok: false, code: "NO_NEW_MODELS" });
    expect(startAdapter).not.toHaveBeenCalled();
  });

  it("redacts a credential if an adapter error unexpectedly echoes it", async () => {
    const { actions, startAdapter } = harness();
    startAdapter.mockImplementationOnce((input) => ({
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
        registerAdapter: vi.fn(),
        startAdapter,
        getAdapterRun: () => ({ ...previousRun, stage }),
      });

      const result = await actions.retry({ runId: previousRun.id });

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
      registerAdapter: vi.fn(),
      startAdapter,
      getAdapterRun: () => previousRun,
    });

    const result = await actions.retry({ runId: previousRun.id, modelKey: "missing-from-catalog" });

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
      registerAdapter: vi.fn(),
      startAdapter,
      getAdapterRun: () => previousRun,
    });

    const result = await actions.retry({ runId: previousRun.id, modelKey: "renderer-injected-model" });

    expect(result).toMatchObject({ ok: false, code: "RUN_MODELS_MISSING" });
    expect(startAdapter).not.toHaveBeenCalled();
  });

  it("rejects an active task before reading its saved credential", async () => {
    const decryptApiKey = vi.fn(() => SECRET);
    const startAdapter = vi.fn();
    const actions = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey,
      fetchModels: vi.fn(),
      registerAdapter: vi.fn(),
      startAdapter,
      getAdapterRun: () => ({ ...previousRun, stage: "testing" }),
    });

    const result = await actions.retry({ runId: previousRun.id });

    expect(result).toMatchObject({ ok: false, code: "RUN_ACTIVE" });
    expect(decryptApiKey).not.toHaveBeenCalled();
    expect(startAdapter).not.toHaveBeenCalled();
  });

  it("rejects an unknown task without consulting renderer-supplied connection data", async () => {
    const startAdapter = vi.fn();
    const actions = createExistingConnectionActions({
      readCatalog: () => catalog(),
      decryptApiKey: () => SECRET,
      fetchModels: vi.fn(),
      registerAdapter: vi.fn(),
      startAdapter,
      getAdapterRun: () => undefined,
    });

    const result = await actions.retry({ runId: "missing" });

    expect(result).toMatchObject({ ok: false, code: "RUN_NOT_FOUND" });
    expect(startAdapter).not.toHaveBeenCalled();
  });
});
