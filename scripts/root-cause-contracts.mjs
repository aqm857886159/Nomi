import path from "node:path";

export const ROOT_CAUSE_CONTRACT_SCHEMA_VERSION = 3;

const PREVENTION_KINDS = new Set([
  "centralized-boundary",
  "schema-validation",
  "type-system",
  "runtime-assertion",
  "static-gate",
  "migration",
  "dependency-upgrade",
]);
const ENTRY_POINT_DISPOSITIONS = new Set(["enforced", "not-affected"]);
const DEPENDENCY_DECISIONS = new Set(["not-applicable", "upgrade-now", "retain-with-exit"]);
const RECURRENCE_CLASSIFICATIONS = new Set(["one_off", "recurring"]);
const CHANGE_KINDS = new Set(["corrective", "structural"]);

const HIGH_RISK_PREFIXES = [
  ".github/workflows/",
  "electron/catalog/",
  "electron/assets/",
  "electron/comfyui/",
  "electron/image/",
  "electron/productionRun/",
  "electron/protocol/",
  "electron/providerAdapter/",
  "electron/tasks/",
  "electron/vendor/",
  "src/workbench/generationCanvas/runner/",
];

const HIGH_RISK_EXACT = new Set([
  "electron/ai/antigravityArtifacts.ts",
  "electron/hardenedFetch.ts",
  "electron/ipcSenderGuard.ts",
  "electron/workspace/workspaceRegistry.ts",
  "scripts/check-root-cause-contracts.mjs",
  "scripts/root-cause-contracts.mjs",
  // —— 交付闸门的执行体（2026-09-02 加）——
  // 收的是同一个风险形状：**静默失效**。它们坏掉时不会报错，只会安静地放行——
  // 一次没过门的 push、一份没扫过的凭据、一个压根没装上的钩子，和正常放行长得一模一样，
  // 只有事后在远端才看得见。当天实测：push 闸的戳只认「固定路径 + mtime」，主仓里一枚别处
  // 盖的旧戳把 gates 实际 exit=1 的分支放上了远端（docs/lessons/gate-stamps-must-be-keyed-to-tree-and-head.md）。
  // 进这张表 = 改它必须带根因合同 + 本次变化中的类级回归测试。
  //
  // 蓄意**不**收 self-check.sh / handoff-*.sh / model-doc-check.sh / stack-currency-check.sh：
  // 那些是提醒型（salience）hook，失效顶多少一层提示，不会把未验证的代码送出去；
  // 把它们也收进来，等于让改一句提示文案都要写合同——门岗一旦开始拦无辜的人，人就会开始绕过门岗。
  "scripts/claude-hooks/pre-push-check.sh",   // R11 push 闸：五门戳的判定方
  "scripts/claude-hooks/secret-guard.sh",     // R25 提交前敏感数据扫描
  "scripts/stamp-gates-ok.mjs",               // 五门戳的签发方（凭据怎么盖、绑什么身份）
  "scripts/ponytail-review-hook.mjs",         // R25 提交/推送前只读评审适配器
  "scripts/install-claude-hooks.cjs",         // 装配器：坏了 = 上面这些根本没装上
  "scripts/install-git-hooks.cjs",
]);

function normalized(file) {
  return String(file || "").replaceAll(path.sep, "/").replace(/^\.\//, "");
}

function isTestFile(file) {
  return /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/i.test(file)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file)
    || /\.node-test\.[cm]?js$/i.test(file);
}

export function isHighRiskProductionFile(file) {
  const name = normalized(file);
  if (isTestFile(name) || name.endsWith(".md") || name.endsWith(".json")) return false;
  return HIGH_RISK_EXACT.has(name)
    || name.startsWith("electron/runtime")
    || HIGH_RISK_PREFIXES.some((prefix) => name.startsWith(prefix))
    || (name.startsWith("electron/") && /(?:ipc|store|repository)\.ts$/i.test(name));
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyTextArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyText);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function scopeCovers(scope, file) {
  const cleanScope = normalized(scope);
  const cleanFile = normalized(file);
  if (cleanScope.endsWith("/**")) return cleanFile.startsWith(cleanScope.slice(0, -3));
  if (cleanScope.endsWith("/")) return cleanFile.startsWith(cleanScope);
  return cleanScope === cleanFile;
}

function pathExists(file, existingFiles) {
  const clean = normalized(file).replace(/\/\*\*$/, "");
  return clean.endsWith("/")
    ? [...existingFiles].some((candidate) => normalized(candidate).startsWith(clean))
    : existingFiles.has(clean) || [...existingFiles].some((candidate) => normalized(candidate).startsWith(`${clean}/`));
}

function pathIsInScope(file, scopePaths) {
  return scopePaths.some((scope) => scopeCovers(scope, file));
}

function fileExists(file, existingFiles) {
  return existingFiles.has(normalized(file));
}

function fileContent(file, fileContents) {
  if (fileContents instanceof Map) return fileContents.get(normalized(file));
  if (record(fileContents)) return fileContents[normalized(file)];
  return undefined;
}

function hasNamedExport(source, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(
    `\\bexport\\s+(?:declare\\s+)?(?:async\\s+)?(?:function|class|const|let|var|interface|type|enum)\\s+${escaped}\\b`,
  );
  if (declaration.test(source)) return true;

  const exportLists = String(source).matchAll(/\bexport\s+(?:type\s+)?{([\s\S]*?)}/g);
  for (const match of exportLists) {
    for (const member of match[1].split(",")) {
      const parts = member.trim().split(/\s+as\s+/);
      const exported = (parts.length > 1 ? parts.at(-1) : parts[0]).trim();
      if (exported === name) return true;
    }
  }
  return false;
}

function validateStructuralContract(contract, changed, existingFiles, label, fileContents) {
  const errors = [];
  const scopePaths = Array.isArray(contract?.scope_paths) ? contract.scope_paths : [];
  const regressionTests = Array.isArray(contract?.regression_tests) ? contract.regression_tests : [];
  const evidence = contract?.structural_evidence;

  if (!record(evidence)) {
    errors.push(`${label}: structural_evidence is required for structural contracts`);
    return errors;
  }

  if (!nonEmptyTextArray(evidence.affected_paths)) {
    errors.push(`${label}: structural_evidence.affected_paths must be a non-empty string array`);
  } else {
    for (const affectedPath of evidence.affected_paths) {
      const clean = normalized(affectedPath);
      if (!fileExists(clean, existingFiles)) errors.push(`${label}: structural affected path does not exist: ${affectedPath}`);
      if (!changed.has(clean)) errors.push(`${label}: structural affected path was not changed in this diff: ${affectedPath}`);
      if (!pathIsInScope(clean, scopePaths)) errors.push(`${label}: structural affected path is not covered by scope_paths: ${affectedPath}`);
    }
  }

  if (!nonEmptyText(evidence.behavior_preservation)) {
    errors.push(`${label}: structural_evidence.behavior_preservation is required`);
  }
  if (!nonEmptyText(evidence.verification_limits)) {
    errors.push(`${label}: structural_evidence.verification_limits is required`);
  }

  if (!Array.isArray(evidence.preserved_exports)) {
    errors.push(`${label}: structural_evidence.preserved_exports must be an array`);
  } else {
    for (const preserved of evidence.preserved_exports) {
      if (!record(preserved) || !nonEmptyText(preserved.path) || !nonEmptyText(preserved.name)) {
        errors.push(`${label}: every preserved_exports entry requires path and name`);
        continue;
      }
      const cleanPath = normalized(preserved.path);
      if (!fileExists(cleanPath, existingFiles)) {
        errors.push(`${label}: preserved export path does not exist: ${preserved.path}`);
        continue;
      }
      if (!changed.has(cleanPath)) errors.push(`${label}: preserved export path was not changed in this diff: ${preserved.path}`);
      if (!pathIsInScope(cleanPath, scopePaths)) errors.push(`${label}: preserved export path is not covered by scope_paths: ${preserved.path}`);
      const source = fileContent(cleanPath, fileContents);
      if (typeof source !== "string") {
        errors.push(`${label}: preserved export cannot be verified because file contents are unavailable: ${preserved.path}`);
      } else if (!hasNamedExport(source, preserved.name.trim())) {
        errors.push(`${label}: named export does not exist in ${preserved.path}: ${preserved.name}`);
      }
    }
  }

  for (const testFile of regressionTests) {
    const clean = normalized(testFile);
    if (!isTestFile(clean)) errors.push(`${label}: regression_tests entry is not a test file: ${testFile}`);
    if (!existingFiles.has(clean)) errors.push(`${label}: regression test does not exist: ${testFile}`);
    if (!changed.has(clean)) errors.push(`${label}: regression test was not changed in this diff: ${testFile}`);
  }
  return errors;
}

function isStructuralPreventionArtifact(file) {
  const name = normalized(file);
  return !isTestFile(name)
    && !name.endsWith(".md")
    && !/^docs\/fixes\/.*\.root-cause\.json$/i.test(name);
}

function validateRecurringContract(contract, changed, existingFiles, label) {
  const errors = [];
  const scopePaths = Array.isArray(contract?.scope_paths) ? contract.scope_paths : [];
  const regressionTests = Array.isArray(contract?.regression_tests) ? contract.regression_tests : [];

  if (!nonEmptyText(contract?.generality_proof)) {
    errors.push(`${label}: generality_proof is required`);
  }

  const boundaries = Array.isArray(contract?.shared_boundaries) ? contract.shared_boundaries : [];
  if (boundaries.length === 0) {
    errors.push(`${label}: shared_boundaries must identify at least one production enforcement boundary`);
  }
  for (const boundary of boundaries) {
    if (!record(boundary) || !nonEmptyText(boundary.path) || !nonEmptyText(boundary.symbol) || !nonEmptyText(boundary.responsibility)) {
      errors.push(`${label}: every shared_boundaries entry requires path, symbol, and responsibility`);
      continue;
    }
    if (!pathExists(boundary.path, existingFiles)) errors.push(`${label}: shared boundary does not exist: ${boundary.path}`);
    if (!pathIsInScope(boundary.path, scopePaths)) errors.push(`${label}: shared boundary is not covered by scope_paths: ${boundary.path}`);
  }

  const equivalentEntries = Array.isArray(contract?.same_class_entry_points) ? contract.same_class_entry_points : [];
  if (equivalentEntries.length < 2) {
    errors.push(`${label}: same_class_entry_points must contain at least two independently checked entries`);
  }
  const entryIdentities = new Set();
  let enforcedEntryCount = 0;
  for (const entry of equivalentEntries) {
    if (!record(entry) || !nonEmptyText(entry.path) || !nonEmptyText(entry.entry_point) ||
      !ENTRY_POINT_DISPOSITIONS.has(entry.disposition) || !nonEmptyText(entry.evidence)) {
      errors.push(`${label}: every same_class_entry_points entry requires path, entry_point, enforced/not-affected disposition, and evidence`);
      continue;
    }
    if (!pathExists(entry.path, existingFiles)) errors.push(`${label}: same-class entry path does not exist: ${entry.path}`);
    if (entry.disposition === "enforced") enforcedEntryCount += 1;
    const identity = `${normalized(entry.path)}#${entry.entry_point.trim()}`;
    if (entryIdentities.has(identity)) errors.push(`${label}: duplicate same-class entry point: ${identity}`);
    entryIdentities.add(identity);
  }
  if (equivalentEntries.length > 0 && enforcedEntryCount === 0) {
    errors.push(`${label}: same_class_entry_points must include at least one enforced entry`);
  }

  const prevention = contract?.prevention;
  if (!record(prevention) || !PREVENTION_KINDS.has(prevention.kind) ||
    !nonEmptyText(prevention.enforcement_path) || !nonEmptyText(prevention.invariant) ||
    !nonEmptyText(prevention.failure_mode) || prevention.exception_policy !== "none" ||
    !nonEmptyText(prevention.strategy) || !nonEmptyTextArray(prevention.artifacts)) {
    errors.push(`${label}: recurring prevention requires kind, enforcement_path, invariant, failure_mode, exception_policy "none", strategy, and artifacts`);
  } else {
    if (!pathExists(prevention.enforcement_path, existingFiles)) {
      errors.push(`${label}: prevention enforcement_path does not exist: ${prevention.enforcement_path}`);
    }
    if (!changed.has(normalized(prevention.enforcement_path))) {
      errors.push(`${label}: prevention enforcement_path was not changed in this diff: ${prevention.enforcement_path}`);
    }
    if (!boundaries.some((boundary) => record(boundary) && normalized(boundary.path) === normalized(prevention.enforcement_path))) {
      errors.push(`${label}: prevention enforcement_path must be one of shared_boundaries`);
    }
    const artifacts = prevention.artifacts.map(normalized);
    for (const artifact of artifacts) {
      if (!changed.has(artifact)) errors.push(`${label}: prevention artifact was not changed in this diff: ${artifact}`);
    }
    if (!artifacts.includes(normalized(prevention.enforcement_path))) {
      errors.push(`${label}: prevention artifacts must include enforcement_path`);
    }
    if (!artifacts.some(isStructuralPreventionArtifact)) {
      errors.push(`${label}: recurring repairs require changed structural prevention, not only tests or documentation`);
    }
  }

  const classTests = Array.isArray(contract?.class_regression_tests) ? contract.class_regression_tests : [];
  if (!nonEmptyTextArray(classTests)) {
    errors.push(`${label}: class_regression_tests must be a non-empty string array`);
  }
  for (const testFile of classTests) {
    const clean = normalized(testFile);
    if (!regressionTests.some((candidate) => normalized(candidate) === clean)) {
      errors.push(`${label}: class regression test is not listed in regression_tests: ${testFile}`);
    }
    if (!changed.has(clean)) errors.push(`${label}: class regression test was not changed in this diff: ${testFile}`);
  }

  const legacy = contract?.legacy_paths;
  if (!record(legacy) || !["removed", "not-applicable"].includes(legacy.status) ||
    !Array.isArray(legacy.removed_paths) || !nonEmptyText(legacy.rationale)) {
    errors.push(`${label}: legacy_paths requires removed/not-applicable status, removed_paths, and rationale`);
  } else if (legacy.status === "removed") {
    if (!nonEmptyTextArray(legacy.removed_paths)) errors.push(`${label}: removed legacy paths must be listed`);
    for (const removedPath of legacy.removed_paths) {
      if (!changed.has(normalized(removedPath))) errors.push(`${label}: removed legacy path was not changed in this diff: ${removedPath}`);
    }
  } else if (legacy.removed_paths.length !== 0) {
    errors.push(`${label}: not-applicable legacy_paths must have an empty removed_paths array`);
  }

  const lifecycle = contract?.dependency_lifecycle;
  if (!record(lifecycle) || !DEPENDENCY_DECISIONS.has(lifecycle.decision) || !nonEmptyText(lifecycle.rationale)) {
    errors.push(`${label}: dependency_lifecycle requires a supported decision and rationale`);
  } else if (lifecycle.decision === "not-applicable") {
    if (lifecycle.current !== undefined || lifecycle.target !== undefined ||
      !Array.isArray(lifecycle.exit_criteria) || lifecycle.exit_criteria.length !== 0) {
      errors.push(`${label}: not-applicable dependency_lifecycle must omit current/target and use empty exit_criteria`);
    }
  } else {
    if (!nonEmptyText(lifecycle.current) || !nonEmptyText(lifecycle.target)) {
      errors.push(`${label}: dependency lifecycle ${lifecycle.decision} requires current and target`);
    }
    if (!nonEmptyTextArray(lifecycle.exit_criteria)) {
      errors.push(`${label}: dependency lifecycle ${lifecycle.decision} requires explicit exit_criteria`);
    }
  }
  return errors;
}

function validateContract(contract, changed, existingFiles, index, fileContents) {
  const label = nonEmptyText(contract?.id) ? contract.id : `contract #${index + 1}`;
  const errors = [];
  if (nonEmptyText(contract?.__file) && !changed.has(normalized(contract.__file))) {
    errors.push(`${label}: contract file was not changed in this diff: ${contract.__file}`);
  }
  if (contract?.schema_version !== ROOT_CAUSE_CONTRACT_SCHEMA_VERSION) {
    errors.push(`${label}: schema_version must be ${ROOT_CAUSE_CONTRACT_SCHEMA_VERSION}`);
  }
  if (!nonEmptyText(contract?.id)) errors.push(`${label}: id is required`);

  const changeKind = contract?.change_kind === undefined ? "corrective" : contract.change_kind;
  if (!CHANGE_KINDS.has(changeKind)) {
    errors.push(`${label}: change_kind must be corrective or structural`);
    return errors;
  }
  if (changeKind === "structural") {
    if (!nonEmptyTextArray(contract?.scope_paths)) {
      errors.push(`${label}: scope_paths must be a non-empty string array`);
    }
    if (!nonEmptyTextArray(contract?.regression_tests)) {
      errors.push(`${label}: regression_tests must be a non-empty string array`);
    }
    errors.push(...validateStructuralContract(contract, changed, existingFiles, label, fileContents));
    return errors;
  }

  for (const field of ["problem_type", "symptom", "direct_cause", "class_root", "migration"]) {
    if (!nonEmptyText(contract?.[field])) errors.push(`${label}: ${field} is required`);
  }
  for (const field of ["affected_population", "scope_paths", "entry_points", "invariants", "regression_tests", "residual_risks"]) {
    if (!nonEmptyTextArray(contract?.[field])) errors.push(`${label}: ${field} must be a non-empty string array`);
  }

  const recurrence = contract?.recurrence;
  if (!record(recurrence) || !RECURRENCE_CLASSIFICATIONS.has(recurrence.classification) ||
    !nonEmptyText(recurrence.reason) || !nonEmptyTextArray(recurrence.same_class_scan)) {
    errors.push(`${label}: recurrence requires one_off/recurring classification, reason, and same_class_scan`);
  }

  const sources = Array.isArray(contract?.external_sources) ? contract.external_sources : [];
  const validSources = sources.every((source) =>
    source && typeof source === "object" &&
    ["official-doc", "source-code"].includes(source.kind) &&
    /^https?:\/\//i.test(String(source.url || "")) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(source.checked_at || "")) &&
    nonEmptyText(source.purpose));
  if ((!sources.length || !validSources) && !nonEmptyText(contract?.internal_only_reason)) {
    errors.push(`${label}: external_sources must contain checked official docs/source code, or internal_only_reason is required`);
  }

  for (const scope of Array.isArray(contract?.scope_paths) ? contract.scope_paths : []) {
    if (!pathExists(scope, existingFiles)) errors.push(`${label}: scope_paths entry does not exist: ${scope}`);
  }

  for (const testFile of Array.isArray(contract?.regression_tests) ? contract.regression_tests : []) {
    const clean = normalized(testFile);
    if (!isTestFile(clean)) errors.push(`${label}: regression_tests entry is not a test file: ${testFile}`);
    if (!existingFiles.has(clean)) errors.push(`${label}: regression test does not exist: ${testFile}`);
    if (!changed.has(clean)) errors.push(`${label}: regression test was not changed in this diff: ${testFile}`);
  }
  if (contract?.schema_version === ROOT_CAUSE_CONTRACT_SCHEMA_VERSION) {
    if (recurrence?.classification === "recurring") {
      errors.push(...validateRecurringContract(contract, changed, existingFiles, label));
    } else if (recurrence?.classification === "one_off" && contract.prevention !== undefined) {
      errors.push(`${label}: proven one_off contracts must omit prevention rather than inventing a reusable boundary`);
    }
  }
  return errors;
}

export function validateRootCauseHistory({ contracts, legacyHashes = new Map() }) {
  const errors = [];
  const contractsByFile = new Map(contracts.map((contract) => [normalized(contract?.__file), contract]));
  for (const contract of contracts) {
    if (!Number.isInteger(contract?.schema_version) || contract.schema_version >= ROOT_CAUSE_CONTRACT_SCHEMA_VERSION) continue;
    const file = normalized(contract?.__file);
    const expectedHash = legacyHashes.get(file);
    if (!expectedHash) errors.push(`${file || contract?.id || "contract"}: new legacy contract is forbidden; use schema_version ${ROOT_CAUSE_CONTRACT_SCHEMA_VERSION}`);
    else if (expectedHash !== contract?.__contentHash) errors.push(`${file}: legacy history changed; migrate this contract to schema_version ${ROOT_CAUSE_CONTRACT_SCHEMA_VERSION}`);
  }
  for (const file of legacyHashes.keys()) {
    if (!contractsByFile.has(normalized(file))) errors.push(`${file}: legacy history baseline points to a missing contract`);
  }
  return { ok: errors.length === 0, errors };
}

export function inheritLegacyContractHashes(legacyHashes, baseContracts) {
  const inherited = new Map(legacyHashes);
  for (const contract of baseContracts) {
    if (!Number.isInteger(contract?.schema_version) || contract.schema_version >= ROOT_CAUSE_CONTRACT_SCHEMA_VERSION ||
      !nonEmptyText(contract?.__file) || !nonEmptyText(contract?.__contentHash)) continue;
    inherited.set(normalized(contract.__file), contract.__contentHash);
  }
  return inherited;
}

export function validateRootCauseChange({ changedFiles, contracts, existingFiles, legacyHashes = new Map(), fileContents = new Map() }) {
  const changed = new Set(changedFiles.map(normalized));
  const existing = new Set([...existingFiles].map(normalized));
  const triggeredFiles = [...changed].filter(isHighRiskProductionFile).sort();
  // 只有本次新增/修改的合同能为本次改动背书。历史合同仍可留作知识，但不会变成以后每次都要
  // 重写的永久枷锁；每个高风险文件只需至少一份“本次变化且完整”的合同覆盖。
  const changedContracts = contracts.filter((contract) =>
    nonEmptyText(contract?.__file) && changed.has(normalized(contract.__file)));
  const changedCurrentContracts = changedContracts.filter((contract) =>
    contract?.schema_version === ROOT_CAUSE_CONTRACT_SCHEMA_VERSION);
  const errors = [];
  for (const [index, contract] of changedCurrentContracts.entries()) {
    errors.push(...validateContract(contract, changed, existing, index, fileContents));
  }
  if (triggeredFiles.length === 0) return { ok: errors.length === 0, errors, triggeredFiles: [] };

  const relevantContracts = changedContracts.filter((contract) => {
    const file = normalized(contract?.__file);
    const current = contract?.schema_version === ROOT_CAUSE_CONTRACT_SCHEMA_VERSION;
    const trustedLegacy = Number.isInteger(contract?.schema_version)
      && contract.schema_version < ROOT_CAUSE_CONTRACT_SCHEMA_VERSION
      && legacyHashes.get(file) === contract?.__contentHash;
    return (current || trustedLegacy) && Array.isArray(contract?.scope_paths) && triggeredFiles.some((file) =>
      contract.scope_paths.some((scope) => scopeCovers(scope, file)));
  });
  for (const file of triggeredFiles) {
    const covered = relevantContracts.some((contract) =>
      Array.isArray(contract?.scope_paths) && contract.scope_paths.some((scope) => scopeCovers(scope, file)));
    if (!covered) errors.push(`High-risk production file is not covered by a root-cause contract: ${file}`);
  }
  if (relevantContracts.length === 0) {
    errors.push("Add a docs/fixes/*.root-cause.json contract for this high-risk production change.");
  }
  return { ok: errors.length === 0, errors, triggeredFiles };
}
