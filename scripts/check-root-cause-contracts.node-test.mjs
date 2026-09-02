import assert from "node:assert/strict";
import test from "node:test";
import {
  inheritLegacyContractHashes,
  isHighRiskProductionFile,
  validateRootCauseChange,
  validateRootCauseHistory,
} from "./root-cause-contracts.mjs";

const completeContract = {
  __file: "docs/fixes/fixture-media-boundary.root-cause.json",
  schema_version: 3,
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
  generality_proof: "Every local and inline provider image converges on one byte-verification boundary before upload.",
  shared_boundaries: [
    {
      path: "electron/catalog/assetLocalization.ts",
      symbol: "localizeAssetsForVendor",
      responsibility: "Reject declared images whose bounded bytes do not match the media contract before any provider request.",
    },
  ],
  same_class_entry_points: [
    {
      path: "electron/catalog/assetLocalization.ts",
      entry_point: "localize local-file image",
      disposition: "enforced",
      evidence: "Local files pass through localizeAssetsForVendor.",
    },
    {
      path: "electron/catalog/assetLocalization.ts",
      entry_point: "localize inline image",
      disposition: "enforced",
      evidence: "Inline data payloads pass through the same byte verification.",
    },
  ],
  recurrence: {
    classification: "recurring",
    reason: "Every equivalent upload can cross the same unchecked byte boundary.",
    same_class_scan: ["Scanned local files and inline media entering the provider upload boundary."],
  },
  prevention: {
    kind: "centralized-boundary",
    enforcement_path: "electron/catalog/assetLocalization.ts",
    invariant: "Unverified bytes never reach an upload strategy.",
    failure_mode: "The shared boundary rejects before network activity.",
    exception_policy: "none",
    strategy: "Enforce verified bytes at the shared upload boundary.",
    artifacts: ["electron/catalog/assetLocalization.ts", "electron/catalog/assetLocalization.test.ts"],
  },
  class_regression_tests: ["electron/catalog/assetLocalization.test.ts"],
  legacy_paths: {
    status: "not-applicable",
    removed_paths: [],
    rationale: "The defect was a missing invariant at the existing shared boundary, not a parallel legacy implementation.",
  },
  dependency_lifecycle: {
    decision: "not-applicable",
    rationale: "No third-party runtime or protocol version controls this internal byte boundary.",
    exit_criteria: [],
  },
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

test("match: patch-shaped contracts without a shared class boundary are rejected", () => {
  const result = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      completeContract.__file,
    ],
    contracts: [{
      ...completeContract,
      shared_boundaries: [],
      same_class_entry_points: [completeContract.same_class_entry_points[0]],
      class_regression_tests: [],
    }],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      completeContract.__file,
    ]),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /shared_boundaries|two independently checked|class_regression_tests/);
});

test("match: retaining an aging dependency without target and exit criteria is rejected", () => {
  const result = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      completeContract.__file,
    ],
    contracts: [{
      ...completeContract,
      dependency_lifecycle: {
        decision: "retain-with-exit",
        current: "decoder@1",
        rationale: "A compatibility option fixes the immediate fixture.",
        exit_criteria: [],
      },
    }],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      completeContract.__file,
    ]),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /requires current and target|requires explicit exit_criteria/);
});

test("match: a contract cannot claim an unchanged boundary or mark every entry unaffected", () => {
  const result = validateRootCauseChange({
    changedFiles: ["electron/catalog/assetLocalization.test.ts", completeContract.__file],
    contracts: [{
      ...completeContract,
      same_class_entry_points: completeContract.same_class_entry_points.map((entry) => ({
        ...entry,
        disposition: "not-affected",
      })),
    }],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      completeContract.__file,
    ]),
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /at least one enforced entry|enforcement_path was not changed/);
});

test("not_match: docs-only changes do not require a contract", () => {
  const result = validateRootCauseChange({
    changedFiles: ["docs/plan/example.md"],
    contracts: [],
    existingFiles: new Set(["docs/plan/example.md"]),
  });
  assert.deepEqual(result, { ok: true, errors: [], triggeredFiles: [] });
});

// 闸门执行体（2026-09-02 加）。这一族的失效是**静默**的：放行得和正常放行一模一样，
// 所以「改它必须带根因合同」这条本身要有测试钉住——否则谁把某个 hook 从名单里删掉，
// 也是静默生效的。同时钉住**反面**：提醒型 hook 不该进这张表，否则改一句提示文案都要写合同。
test("match: 交付闸门的执行体算高风险，提醒型 hook 不算", () => {
  for (const file of [
    "scripts/claude-hooks/pre-push-check.sh",
    "scripts/claude-hooks/secret-guard.sh",
    "scripts/stamp-gates-ok.mjs",
    "scripts/ponytail-review-hook.mjs",
    "scripts/install-claude-hooks.cjs",
    "scripts/install-git-hooks.cjs",
  ]) {
    assert.equal(isHighRiskProductionFile(file), true, `闸门执行体必须算高风险：${file}`);
  }
  for (const file of [
    "scripts/claude-hooks/self-check.sh",
    "scripts/claude-hooks/handoff-write.sh",
    "scripts/claude-hooks/model-doc-check.sh",
    "scripts/claude-hooks/stack-currency-check.sh",
  ]) {
    assert.equal(isHighRiskProductionFile(file), false, `提醒型 hook 不该进高风险名单：${file}`);
  }
  // 闸门的测试文件本身仍走 isTestFile 豁免——否则改测试也要写合同，会把人逼去绕过门岗。
  assert.equal(isHighRiskProductionFile("scripts/pre-push-check.node-test.mjs"), false);
});

test("match: every changed schema v3 contract is validated even without a high-risk production path", () => {
  const result = validateRootCauseChange({
    changedFiles: [completeContract.__file, "electron/catalog/assetLocalization.test.ts"],
    contracts: [{ ...completeContract, shared_boundaries: [] }],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      completeContract.__file,
    ]),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.triggeredFiles, []);
  assert.match(result.errors.join("\n"), /shared_boundaries/);
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

test("match: changed contracts require an explicit recurrence classification", () => {
  const contract = { ...completeContract, recurrence: undefined };
  const files = [
    "electron/catalog/assetLocalization.ts",
    "electron/catalog/assetLocalization.test.ts",
    contract.__file,
  ];
  const result = validateRootCauseChange({ changedFiles: files, contracts: [contract], existingFiles: new Set(files) });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /recurrence/);
});

test("match: recurring repairs require changed structural prevention", () => {
  const contract = {
    ...completeContract,
    prevention: {
      ...completeContract.prevention,
      enforcement_path: "electron/catalog/assetLocalization.test.ts",
      artifacts: ["electron/catalog/assetLocalization.test.ts"],
    },
  };
  const files = [
    "electron/catalog/assetLocalization.ts",
    "electron/catalog/assetLocalization.test.ts",
    contract.__file,
  ];
  const result = validateRootCauseChange({ changedFiles: files, contracts: [contract], existingFiles: new Set(files) });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /structural prevention|shared_boundaries/);
});

test("not_match: a proven one-off does not manufacture a reusable boundary", () => {
  const contract = {
    ...completeContract,
    recurrence: {
      classification: "one_off",
      reason: "The malformed fixture is not produced by any repository path.",
      same_class_scan: ["Scanned every fixture producer and found no equivalent writer."],
    },
    prevention: undefined,
  };
  const files = [
    "electron/catalog/assetLocalization.ts",
    "electron/catalog/assetLocalization.test.ts",
    contract.__file,
  ];
  const result = validateRootCauseChange({ changedFiles: files, contracts: [contract], existingFiles: new Set(files) });
  assert.equal(result.ok, true);
});

test("high-risk matcher covers workflows, providers, media, network, IPC, and persistence boundaries", () => {
  for (const file of [
    ".github/workflows/cla.yml",
    "electron/vendor/vendorHttp.ts",
    "electron/image/decomposeLayers.ts",
    "electron/ai/antigravityArtifacts.ts",
    "electron/hardenedFetch.ts",
    "electron/providerAdapter/ipc.ts",
    "electron/workspace/workspaceRepository.ts",
    "electron/workspace/workspaceRegistry.ts",
    "electron/comfyui/capabilityStore.ts",
    "scripts/root-cause-contracts.mjs",
  ]) assert.equal(isHighRiskProductionFile(file), true, file);
  for (const file of [
    "electron/vendor/vendorHttp.test.ts",
    "scripts/check-root-cause-contracts.node-test.mjs",
    "docs/plan/example.md",
    "src/components/Button.tsx",
  ]) assert.equal(isHighRiskProductionFile(file), false, file);
});

test("legacy schema history is immutable and new legacy contracts are rejected", () => {
  const legacy = {
    ...completeContract,
    schema_version: 1,
    __file: "docs/fixes/legacy.root-cause.json",
    __contentHash: "known-hash",
  };
  assert.deepEqual(
    validateRootCauseHistory({ contracts: [legacy], legacyHashes: new Map([[legacy.__file, "known-hash"]]) }),
    { ok: true, errors: [] },
  );

  const changed = validateRootCauseHistory({
    contracts: [{ ...legacy, __contentHash: "changed-hash" }],
    legacyHashes: new Map([[legacy.__file, "known-hash"]]),
  });
  assert.equal(changed.ok, false);
  assert.match(changed.errors.join("\n"), /history changed/i);

  const added = validateRootCauseHistory({ contracts: [legacy], legacyHashes: new Map() });
  assert.equal(added.ok, false);
  assert.match(added.errors.join("\n"), /new legacy contract is forbidden/i);
});

test("schema v1 and v2 contracts on the trusted base become immutable inherited history", () => {
  const inherited = {
    ...completeContract,
    schema_version: 1,
    __file: "docs/fixes/concurrent-main-history.root-cause.json",
    __contentHash: "base-hash",
  };
  const inheritedV2 = {
    ...inherited,
    schema_version: 2,
    __file: "docs/fixes/concurrent-main-v2.root-cause.json",
    __contentHash: "base-v2-hash",
  };
  const hashes = inheritLegacyContractHashes(new Map(), [inherited, inheritedV2]);

  assert.deepEqual(
    validateRootCauseHistory({ contracts: [inherited, inheritedV2], legacyHashes: hashes }),
    { ok: true, errors: [] },
  );

  const modified = validateRootCauseHistory({
    contracts: [{ ...inherited, __contentHash: "branch-hash" }, inheritedV2],
    legacyHashes: hashes,
  });
  assert.equal(modified.ok, false);
  assert.match(modified.errors.join("\n"), /history changed/i);

  const branchOnly = {
    ...inherited,
    __file: "docs/fixes/branch-only-v1.root-cause.json",
  };
  const added = validateRootCauseHistory({ contracts: [inherited, inheritedV2, branchOnly], legacyHashes: hashes });
  assert.equal(added.ok, false);
  assert.match(added.errors.join("\n"), /new legacy contract is forbidden/i);
});

test("an exact bootstrap legacy hash covers its original diff without becoming a future bypass", () => {
  const legacy = {
    ...completeContract,
    schema_version: 2,
    recurrence: undefined,
    __contentHash: "trusted-v2-hash",
  };
  const result = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      legacy.__file,
    ],
    contracts: [legacy],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      legacy.__file,
    ]),
    legacyHashes: new Map([[legacy.__file, legacy.__contentHash]]),
  });

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.errors.join("\n"), /recurrence|schema_version/);

  const future = validateRootCauseChange({
    changedFiles: [
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
    ],
    contracts: [legacy],
    existingFiles: new Set([
      "electron/catalog/assetLocalization.ts",
      "electron/catalog/assetLocalization.test.ts",
      legacy.__file,
    ]),
    legacyHashes: new Map([[legacy.__file, legacy.__contentHash]]),
  });
  assert.equal(future.ok, false);
  assert.match(future.errors.join("\n"), /not covered/i);
});
