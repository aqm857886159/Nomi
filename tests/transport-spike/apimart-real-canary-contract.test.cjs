"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const contract = require("./apimart-real-canary-contract.cjs");

function catalog({ imageModels = ["gpt-image-2"], videoModels = [] } = {}) {
  const models = [
    ...imageModels.map((modelKey) => ({
      vendorKey: "apimart",
      modelKey,
      kind: "image",
      enabled: true,
      published: true,
    })),
    ...videoModels.map((modelKey) => ({
      vendorKey: "apimart",
      modelKey,
      kind: "video",
      enabled: true,
      published: true,
    })),
  ];
  const mappings = models.map((model) => ({
    id: `${model.modelKey}-${model.kind}`,
    vendorKey: "apimart",
    modelKey: model.modelKey,
    taskKind: model.kind === "image" ? "text_to_image" : "text_to_video",
    enabled: true,
  }));
  return {
    vendors: [{ key: "apimart", enabled: true }],
    models,
    mappings,
  };
}

test("ordinary invocation is explicitly zero-cost", () => {
  const parsed = contract.parseCanaryConfig({});
  assert.deepEqual(parsed, { enabled: false, reason: "NOMI_APIMART_REAL_CANARY is not 1" });
});

test("paid invocation requires an explicit confirmation, dated price acknowledgement, and cap", () => {
  assert.throws(
    () => contract.parseCanaryConfig({ NOMI_APIMART_REAL_CANARY: "1" }),
    (error) => error.code === "canary_confirmation_required",
  );
  assert.throws(
    () => contract.parseCanaryConfig({
      NOMI_APIMART_REAL_CANARY: "1",
      NOMI_APIMART_REAL_CANARY_CONFIRM: "ONE_PAID_JOB",
    }),
    (error) => error.code === "canary_price_ack_required",
  );
  const parsed = contract.parseCanaryConfig({
    NOMI_APIMART_REAL_CANARY: "1",
    NOMI_APIMART_REAL_CANARY_CONFIRM: "ONE_PAID_JOB",
    NOMI_APIMART_CANARY_PRICE_ACK: "2026-08-31",
    NOMI_APIMART_CANARY_MAX_USD: "0.0085",
    NOMI_APIMART_CANARY_PROXY: "http://127.0.0.1:7897",
  });
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.proxy, "http://127.0.0.1:7897");
  assert.throws(() => contract.assertSpendWithinCap({ estimatedCostUsd: 0.0085 }, 0.0084), /exceeds/);
});

test("selector chooses the cheapest acknowledged image row and requires a mapping", () => {
  const selected = contract.selectCheapestCanaryModel(catalog({ imageModels: ["z-image-turbo", "gpt-image-2"] }), "image");
  assert.equal(selected.modelKey, "gpt-image-2");
  assert.equal(selected.estimatedCostUsd, 0.0085);
  assert.deepEqual(selected.parameters, { aspect_ratio: "1:1", resolution: "1K" });
  assert.equal(selected.mappingId, "gpt-image-2-image");
  assert.throws(
    () => contract.selectCheapestCanaryModel(catalog({ imageModels: ["z-image-turbo"] }), "video"),
    (error) => error.code === "canary_model_unpriced_or_unavailable",
  );
});

test("canonical image parameters must project to APIMart's wire fields before spend", () => {
  const selected = contract.selectCheapestCanaryModel(catalog(), "image");
  assert.equal(
    contract.assertCanaryWireProjection(
      selected,
      { model: "gpt-image-2", prompt: "cat", size: "1:1", resolution: "1k" },
      "cat",
    ),
    true,
  );
  assert.throws(
    () => contract.assertCanaryWireProjection(
      selected,
      { model: "gpt-image-2", prompt: "cat", size: "auto", resolution: "1k" },
      "cat",
    ),
    /size\/aspect-ratio projection drifted/,
  );
});

test("selector rejects disabled, unpublished, or drifted catalog rows", () => {
  const disabled = catalog();
  disabled.models[0].enabled = false;
  assert.throws(() => contract.selectCheapestCanaryModel(disabled, "image"), /no enabled/);

  const unpublished = catalog();
  unpublished.models[0].published = false;
  assert.throws(() => contract.selectCheapestCanaryModel(unpublished, "image"), /no enabled/);

  const drifted = catalog();
  drifted.models[0].pricing = { enabled: true, cost: 9 };
  assert.throws(
    () => contract.selectCheapestCanaryModel(drifted, "image"),
    (error) => error.code === "canary_price_drift",
  );
});

test("video selection freezes the shortest test-only Seedance parameters", () => {
  const selected = contract.selectCheapestCanaryModel(catalog({ imageModels: [], videoModels: ["doubao-seedance-2.0"] }), "video");
  assert.deepEqual(selected.parameters, {
    model: "doubao-seedance-2.0-mini",
    size: "16:9",
    resolution: "480p",
    duration: 4,
    generate_audio: false,
  });
  assert.equal(selected.transportModelId, "doubao-seedance-2.0-mini");
  assert.equal(selected.estimatedCostUsd, 0.04224);
});

test("status/output helpers are conservative and redact credentials", () => {
  assert.equal(contract.normaliseTerminalStatus("processing"), "pending");
  assert.equal(contract.normaliseTerminalStatus("completed"), "succeeded");
  assert.equal(contract.normaliseTerminalStatus("mystery"), "unknown");
  assert.equal(contract.extractTaskId({ data: [{ task_id: "task-1" }] }), "task-1");
  assert.deepEqual(
    contract.extractOutputUrls({ data: { result: { images: [["https://cdn.example/a.png"]] } } }, "image"),
    ["https://cdn.example/a.png"],
  );
  assert.equal(contract.redactText("Bearer sk-secret"), "Bearer ***");
  assert.equal(contract.redactText("https://example.test/?token=secret"), "https://example.test/?token=***");
  assert.doesNotMatch(contract.redactText("Bearer sk-secret&token=secret"), /sk-secret|token=secret/);
});
