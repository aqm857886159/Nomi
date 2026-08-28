import path from "node:path";

export const ROOT_CAUSE_CONTRACT_SCHEMA_VERSION = 2;

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
  "electron/hardenedFetch.ts",
  "electron/ipcSenderGuard.ts",
  "electron/workspace/workspaceRegistry.ts",
  "scripts/check-root-cause-contracts.mjs",
  "scripts/root-cause-contracts.mjs",
]);

const RECURRENCE_CLASSIFICATIONS = new Set(["one_off", "recurring"]);

function normalized(file) {
  return String(file || "").replaceAll(path.sep, "/").replace(/^\.\//, "");
}

function isTestFile(file) {
  return /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/i.test(file) || /\.(?:node-test|test|spec)\.[cm]?[jt]sx?$/i.test(file);
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

function scopeCovers(scope, file) {
  const cleanScope = normalized(scope);
  const cleanFile = normalized(file);
  if (cleanScope.endsWith("/**")) return cleanFile.startsWith(cleanScope.slice(0, -3));
  if (cleanScope.endsWith("/")) return cleanFile.startsWith(cleanScope);
  return cleanScope === cleanFile;
}

function isStructuralPreventionArtifact(file) {
  const name = normalized(file);
  return !isTestFile(name)
    && !name.endsWith(".md")
    && !/^docs\/fixes\/.*\.root-cause\.json$/i.test(name);
}

function validateContract(contract, changed, existingFiles, index) {
  const label = nonEmptyText(contract?.id) ? contract.id : `contract #${index + 1}`;
  const errors = [];
  if (nonEmptyText(contract?.__file) && !changed.has(normalized(contract.__file))) {
    errors.push(`${label}: contract file was not changed in this diff: ${contract.__file}`);
  }
  if (contract?.schema_version !== ROOT_CAUSE_CONTRACT_SCHEMA_VERSION) {
    errors.push(`${label}: schema_version must be ${ROOT_CAUSE_CONTRACT_SCHEMA_VERSION}`);
  }
  for (const field of ["id", "problem_type", "symptom", "direct_cause", "class_root", "migration"]) {
    if (!nonEmptyText(contract?.[field])) errors.push(`${label}: ${field} is required`);
  }
  for (const field of ["affected_population", "scope_paths", "entry_points", "invariants", "regression_tests", "residual_risks"]) {
    if (!nonEmptyTextArray(contract?.[field])) errors.push(`${label}: ${field} must be a non-empty string array`);
  }

  const recurrence = contract?.recurrence;
  if (!recurrence || typeof recurrence !== "object" || Array.isArray(recurrence)) {
    errors.push(`${label}: recurrence must classify the repair as one_off or recurring`);
  } else {
    if (!RECURRENCE_CLASSIFICATIONS.has(recurrence.classification)) {
      errors.push(`${label}: recurrence.classification must be one_off or recurring`);
    }
    if (!nonEmptyText(recurrence.reason)) errors.push(`${label}: recurrence.reason is required`);
    if (!nonEmptyTextArray(recurrence.same_class_scan)) {
      errors.push(`${label}: recurrence.same_class_scan must contain concrete repository scan evidence`);
    }
  }

  if (recurrence?.classification === "recurring") {
    const prevention = contract?.prevention;
    if (!prevention || typeof prevention !== "object" || Array.isArray(prevention)) {
      errors.push(`${label}: recurring repairs require prevention.strategy and prevention.artifacts`);
    } else {
      if (!nonEmptyText(prevention.strategy)) errors.push(`${label}: prevention.strategy is required`);
      if (!nonEmptyTextArray(prevention.artifacts)) {
        errors.push(`${label}: prevention.artifacts must be a non-empty string array`);
      } else {
        const artifacts = prevention.artifacts.map(normalized);
        for (const artifact of artifacts) {
          if (!changed.has(artifact)) {
            errors.push(`${label}: prevention artifact was not changed in this diff: ${artifact}`);
          }
        }
        if (!artifacts.some(isStructuralPreventionArtifact)) {
          errors.push(`${label}: recurring repairs require changed structural prevention, not only tests or documentation`);
        }
      }
    }
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
    const clean = normalized(scope).replace(/\/\*\*$/, "");
    const exists = clean.endsWith("/")
      ? [...existingFiles].some((file) => normalized(file).startsWith(clean))
      : existingFiles.has(clean) || [...existingFiles].some((file) => normalized(file).startsWith(`${clean}/`));
    if (!exists) errors.push(`${label}: scope_paths entry does not exist: ${scope}`);
  }

  for (const testFile of Array.isArray(contract?.regression_tests) ? contract.regression_tests : []) {
    const clean = normalized(testFile);
    if (!isTestFile(clean)) errors.push(`${label}: regression_tests entry is not a test file: ${testFile}`);
    if (!existingFiles.has(clean)) errors.push(`${label}: regression test does not exist: ${testFile}`);
    if (!changed.has(clean)) errors.push(`${label}: regression test was not changed in this diff: ${testFile}`);
  }
  return errors;
}

export function validateRootCauseChange({ changedFiles, contracts, existingFiles }) {
  const changed = new Set(changedFiles.map(normalized));
  const existing = new Set([...existingFiles].map(normalized));
  const triggeredFiles = [...changed].filter(isHighRiskProductionFile).sort();

  // 只有本次新增/修改的合同能为本次改动背书。历史合同仍可留作知识，但不会变成以后每次都要
  // 重写的永久枷锁；每个高风险文件只需至少一份“本次变化且完整”的合同覆盖。
  const changedContracts = contracts.filter((contract) =>
    nonEmptyText(contract?.__file) && changed.has(normalized(contract.__file)));
  const errors = [];
  changedContracts.forEach((contract, index) => errors.push(...validateContract(contract, changed, existing, index)));
  if (triggeredFiles.length === 0) return { ok: errors.length === 0, errors, triggeredFiles: [] };

  const relevantContracts = changedContracts.filter((contract) =>
    Array.isArray(contract?.scope_paths) && triggeredFiles.some((file) =>
      contract.scope_paths.some((scope) => scopeCovers(scope, file))));
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
