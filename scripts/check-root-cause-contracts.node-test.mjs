import assert from "node:assert/strict";
import test from "node:test";
import { isHighRiskProductionFile, validateRootCauseChange } from "./root-cause-contracts.mjs";

const completeContract = {
  __file: "docs/fixes/fixture-media-boundary.root-cause.json",
  schema_version: 1,
  id: "fixture-media-boundary",
  problem_type: "provider_media_boundary",
  symptom: "The provider receives an invalid image URL.",
  direct_cause: "An upload URL dereferences to HTML.",
  class_root: "Uploaded media URLs were trusted by shape instead of verified by bytes.",
  affected_population: ["video tasks with locally uploaded reference images"],
  scope_paths: ["electron/catalog/assetLocalization.ts"],
  entry_points: ["localizeAssetsForVendor"],
  external_sources: [
    { kind: "official-doc", url: "https://example.com/docs", checked_at: "2026-08-27", purpose: "fixture" },
  ],
  invariants: ["HTML is never sent as an image."],
  regression_tests: ["electron/catalog/assetLocalization.test.ts"],
  migration: "Existing stored values are validated on their next upload.",
  residual_risks: ["Provider-owned URLs outside the upload boundary are not re-fetched."],
};

test("match: high-risk production changes require a contract", () => {
  const result = validateRootCauseChange({
    changedFiles: ["electron/catalog/assetLocalization.ts", "electron/catalog/assetLocalization.test.ts"],
    contracts: [],
    existingFiles: new Set(["electron/catalog/assetLocalization.ts", "electron/catalog/assetLocalization.test.ts"]),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /not covered/i);
});

test("match: incomplete contracts cannot satisfy the gate", () => {
  const result = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      "docs/fixes/fixture-media-boundary.root-cause.json",
    ],
    contracts: [{ ...completeContract, class_root: "", external_sources: [], regression_tests: [] }],
    existingFiles: new Set(["electron/catalog/assetLocalization.ts", "electron/catalog/assetLocalization.test.ts"]),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /class_root|external_sources|regression_tests/);
});

test("not_match: docs-only changes do not require a contract", () => {
  const result = validateRootCauseChange({
    changedFiles: ["docs/plan/example.md"],
    contracts: [],
    existingFiles: new Set(["docs/plan/example.md"]),
  });
  assert.deepEqual(result, { ok: true, errors: [], triggeredFiles: [] });
});

test("match: a complete contract covers changed production and test files", () => {
  const result = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      "docs/fixes/fixture-media-boundary.root-cause.json",
    ],
    contracts: [completeContract],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      "docs/fixes/fixture-media-boundary.root-cause.json",
    ]),
  });
  assert.deepEqual(result, {
    ok: true,
    errors: [],
    triggeredFiles: ["electron/catalog/assetLocalization.ts"],
  });
});

test("match: repository node-test files are valid changing regression evidence", () => {
  const workflowContract = {
    ...completeContract,
    __file: "docs/fixes/fixture-workflow.root-cause.json",
    id: "fixture-workflow",
    scope_paths: [".github/workflows/cla.yml"],
    regression_tests: ["scripts/check-cla-workflow.node-test.mjs"],
  };
  const files = [
    ".github/workflows/cla.yml",
    "scripts/check-cla-workflow.node-test.mjs",
    workflowContract.__file,
  ];
  const result = validateRootCauseChange({
    changedFiles: files,
    contracts: [workflowContract],
    existingFiles: new Set(files),
  });
  assert.deepEqual(result, {
    ok: true,
    errors: [],
    triggeredFiles: [".github/workflows/cla.yml"],
  });
});

test("not_match: unrelated historical contracts are ignored", () => {
  const unrelated = {
    ...completeContract,
    __file: "docs/fixes/historical.root-cause.json",
    id: "historical",
    scope_paths: ["electron/tasks/oldTask.ts"],
    regression_tests: ["electron/tasks/oldTask.test.ts"],
  };
  const result = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      "docs/fixes/fixture-media-boundary.root-cause.json",
    ],
    contracts: [unrelated, completeContract],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      "docs/fixes/fixture-media-boundary.root-cause.json",
    ]),
  });
  assert.equal(result.ok, true);
});

test("match: a relevant historical contract cannot satisfy a new change by itself", () => {
  const result = validateRootCauseChange({
    changedFiles: ["electron/catalog/assetLocalization.ts", "electron/catalog/assetLocalization.test.ts"],
    contracts: [completeContract],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      "docs/fixes/fixture-media-boundary.root-cause.json",
    ]),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /not covered|Add a docs\/fixes/i);
});

test("match: a new complete contract may supersede a relevant historical contract without rewriting history", () => {
  const historical = { ...completeContract, __file: "docs/fixes/historical.root-cause.json", id: "historical" };
  const current = { ...completeContract, id: "current" };
  const result = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      current.__file,
    ],
    contracts: [historical, current],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      historical.__file,
      current.__file,
    ]),
  });
  assert.equal(result.ok, true);
});

test("high-risk matcher covers workflows, providers, media, network, IPC, and persistence boundaries", () => {
  for (const file of [
    ".github/workflows/cla.yml",
    "electron/vendor/vendorHttp.ts",
    "electron/image/decomposeLayers.ts",
    "electron/hardenedFetch.ts",
    "electron/providerAdapter/ipc.ts",
    "electron/workspace/workspaceRepository.ts",
    "electron/workspace/workspaceRegistry.ts",
    "electron/comfyui/capabilityStore.ts",
  ]) assert.equal(isHighRiskProductionFile(file), true, file);
  for (const file of [
    "electron/vendor/vendorHttp.test.ts",
    "docs/plan/example.md",
    "src/components/Button.tsx",
  ]) assert.equal(isHighRiskProductionFile(file), false, file);
});
