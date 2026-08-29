import { describe, expect, it } from "vitest";

import {
  PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
  assertProductionGenerationPayloadHash,
  createProductionGenerationAuthorizationEnvelope,
  productionGenerationAuthorizationDigest,
  productionGenerationPayloadHash,
  type ProductionGenerationAuthorizationEnvelopeV1,
} from "./productionGenerationAuthorization";

function envelope(): ProductionGenerationAuthorizationEnvelopeV1 {
  const payload = { model: "model-1", prompt: "A quiet lake", references: ["asset-1"] };
  return {
    schemaVersion: PRODUCTION_GENERATION_AUTHORIZATION_VERSION,
    immutableProjectUuid: "project-uuid-1",
    projectGeneration: 3,
    projectId: "project-1",
    projectRevision: 12,
    runId: "run-1",
    planVersion: 4,
    jobs: [{
      jobId: "job-1",
      shotId: "shot-1",
      node: { nodeId: "node-1", nodeRevision: 7, currentResultId: "result-1", currentResultContentHash: "result-hash-1" },
      contractHash: "contract-1",
      providerId: "provider-1",
      modelId: "model-1",
      mode: "image-to-video",
      parameters: { duration: 5, ratio: "16:9" },
      references: [{ assetId: "asset-1", contentHash: "asset-hash-1", version: 2, kind: "image", role: "character" }],
      providerWirePayloadHash: productionGenerationPayloadHash(payload),
      providerIdempotencyKey: "generation:run-1:shot-1:attempt-1",
      price: { currency: "CNY", maximum: 6 },
    }],
    budget: { currency: "CNY", maximum: 6 },
  };
}

describe("ProductionGenerationAuthorizationEnvelope", () => {
  it("is stable across object key ordering", () => {
    const first = envelope();
    const second = { ...first, budget: { maximum: 6, currency: "CNY" } };
    expect(productionGenerationAuthorizationDigest(first)).toBe(productionGenerationAuthorizationDigest(second));
  });

  it.each([
    ["project identity", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, immutableProjectUuid: "project-uuid-2" })],
    ["project revision", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, projectRevision: 13 })],
    ["node revision", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], node: { ...value.jobs[0].node, nodeRevision: 8 } }] })],
    ["result identity", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], node: { ...value.jobs[0].node, currentResultId: "result-2" } }] })],
    ["model", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], modelId: "model-2" }] })],
    ["provider", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], providerId: "provider-2" }] })],
    ["parameter", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], parameters: { duration: 8, ratio: "16:9" } }] })],
    ["reference role", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], references: [{ ...value.jobs[0].references[0], role: "first_frame" }] }] })],
    ["job set", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], jobId: "job-2" }] })],
    ["wire payload", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], providerWirePayloadHash: productionGenerationPayloadHash({ changed: true }) }] })],
    ["idempotency identity", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], providerIdempotencyKey: "generation:run-1:shot-1:attempt-2" }] })],
    ["budget", (value: ProductionGenerationAuthorizationEnvelopeV1) => ({ ...value, jobs: [{ ...value.jobs[0], price: { currency: "CNY", maximum: 7 } }], budget: { currency: "CNY", maximum: 7 } })],
  ])("changes the digest when %s changes", (_label, mutate) => {
    const original = envelope();
    expect(productionGenerationAuthorizationDigest(mutate(original))).not.toBe(productionGenerationAuthorizationDigest(original));
  });

  it("rejects a provider payload that differs from the approved hash", () => {
    const expected = productionGenerationPayloadHash({ model: "model-1", prompt: "approved" });
    expect(() => assertProductionGenerationPayloadHash({ model: "model-1", prompt: "changed" }, expected)).toThrow(
      "Provider wire payload no longer matches",
    );
  });

  it("rejects budget ceilings that do not equal the exact ordered jobs", () => {
    const value = envelope();
    expect(() => createProductionGenerationAuthorizationEnvelope({ ...value, budget: { currency: "CNY", maximum: 7 } })).toThrow(
      "Budget ceiling must equal",
    );
  });
});
