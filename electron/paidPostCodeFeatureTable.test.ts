import { describe, expect, it, vi } from "vitest";
import { createCatalogGenerationProvider } from "./capabilityCore/apimartGenerationProvider";
import type { CatalogState, Vendor } from "./catalog/types";
import { looksLikeLogicalError } from "./ai/requestPipeline";
import { providerExplicitlyRejected } from "./outboundDispatchEvidence";

type Verdict = "成功" | "逻辑错" | "明确拒绝" | "未知";

const vendor: Vendor = {
  key: "acme",
  name: "Acme",
  enabled: true,
  baseUrlHint: "https://acme.example",
  authType: "bearer",
  createdAt: "now",
  updatedAt: "now",
};

const catalog = (): CatalogState => ({
  version: 11,
  vendors: [vendor],
  models: [{ vendorKey: "acme", modelKey: "acme-image", kind: "image", enabled: true, labelZh: "Acme", createdAt: "now" }],
  mappings: [{
    id: "acme-text_to_image",
    vendorKey: "acme",
    modelKey: "acme-image",
    taskKind: "text_to_image",
    name: "Acme",
    enabled: true,
    create: { method: "POST", path: "/v2/jobs", body: { prompt: "{{request.prompt}}" }, response_mapping: { task_id: "id" } },
    query: { method: "GET", path: "/v2/jobs/{{providerMeta.task_id}}", response_mapping: { status: "status" } },
    createdAt: "now",
    updatedAt: "now",
  }],
  apiKeysByVendor: {},
} as CatalogState);

const codeCases: Array<{ label: string; body: Record<string, unknown>; logical: number | null }> = [
  { label: "code=0", body: { code: 0 }, logical: null },
  { label: "code=1", body: { code: 1 }, logical: null },
  { label: "code=22", body: { code: 22 }, logical: null },
  { label: "code=200", body: { code: 200 }, logical: null },
  { label: "code=1001", body: { code: 1001 }, logical: null },
  { label: "code=10000", body: { code: 10000 }, logical: null },
  { label: 'code="0"', body: { code: "0" }, logical: null },
  { label: 'code="1004"', body: { code: "1004" }, logical: 1004 },
  { label: 'code="success"', body: { code: "success" }, logical: null },
  { label: "errorCode=0", body: { errorCode: 0 }, logical: null },
  { label: "errorCode=1004", body: { errorCode: 1004 }, logical: 1004 },
];

async function sharedVerdict(status: number, body: Record<string, unknown>): Promise<Verdict> {
  const logicalCode = looksLikeLogicalError(body);
  if (status === 200 && logicalCode == null) return "成功";
  const error = Object.assign(new Error("provider answered"), {
    providerAnswer: { httpStatus: status, envelopeFailure: logicalCode != null, taskIdReturned: false },
  });
  return providerExplicitlyRejected(error) ? "明确拒绝" : "未知";
}

async function catalogVerdict(status: number, body: Record<string, unknown>): Promise<Verdict> {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
  const provider = createCatalogGenerationProvider({
    vendorKey: "acme",
    catalogReader: catalog,
    resolveConnection: () => ({ apiKey: "test-key" }),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const request = provider.buildRequest({
    moduleId: "generation.single-shot",
    providerId: "acme",
    modelId: "acme-image",
    mode: "text-to-image",
    prompt: "x",
    parameters: {},
    references: [],
    contractHash: "a".repeat(64),
    idempotencyKey: "k",
  });
  try {
    await provider.submit(structuredClone(request), "k");
    return "成功";
  } catch (error) {
    return providerExplicitlyRejected(error) ? "明确拒绝" : "未知";
  }
}

describe("paid POST code feature table: main baseline", () => {
  it("records shared requestJson classification and final rejection verdict", async () => {
    for (const testCase of codeCases) {
      expect(looksLikeLogicalError(testCase.body), testCase.label).toBe(testCase.logical);
      expect(await sharedVerdict(200, testCase.body), testCase.label).toBe(testCase.logical == null ? "成功" : "明确拒绝");
    }
    expect(await sharedVerdict(400, { error: { message: "bad" } })).toBe("明确拒绝");
    expect(await sharedVerdict(500, { error: { message: "busy" } })).toBe("未知");
  });

  it("records the catalog/APIMart mapping's strict 0/200 behavior", async () => {
    const successCases = [{ code: 0, id: "task-0" }, { code: 200, id: "task-200" }, { errorCode: 0, id: "task-ec0" }];
    for (const body of successCases) expect(await catalogVerdict(200, body), JSON.stringify(body)).toBe("成功");
    for (const body of [
      { code: 1 }, { code: 22 }, { code: 1001 }, { code: 10000 }, { code: "0" }, { code: "1004" }, { code: "success" },
    ]) expect(await catalogVerdict(200, body), JSON.stringify(body)).toBe("明确拒绝");
    expect(await catalogVerdict(200, { errorCode: 1004, id: "task-ec1004" })).toBe("成功");
    expect(await catalogVerdict(400, { error: { message: "bad" } })).toBe("明确拒绝");
    expect(await catalogVerdict(500, { error: { message: "busy" } })).toBe("未知");
  });
});
