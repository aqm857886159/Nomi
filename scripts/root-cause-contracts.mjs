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
  // 花钱确认面（2026-09-03 加）：决定「这次花钱要不要问人、问在哪、谁的同意算数」的三处。
  // 加它们的理由是一次真事故：签发点无条件要求客户端凭证、而验证凭证的回调在两个生产装配点都没接——
  // 两件事分开看都不像 bug，合起来把「弹在调用方」的主确认面整个堵死：用户在 Claude Code 里点了同意
  // 也不算数，每次都被赶回 Nomi 应用，Nomi 没开就直接拒绝。这类改动必须写清「这一类的入口集在哪、
  // 防线是什么」才放行，不能只靠单点 review。
  "electron/capabilityCore/mcpGateConfirmation.ts",
  "electron/capabilityCore/generationDispatcher.ts",
  "electron/capabilityCore/runOwnedGenerationGateAuthority.ts",
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

/**
 * `invariant_owner_layer` 从这天（含）起必填（2026-09-07）。日期取合同文件名前缀；
 * 没有日期前缀的（fixture / 老命名）不追溯——追溯会把 200 多份历史合同一次性打红。
 */
export const INVARIANT_OWNER_LAYER_SINCE = "2026-09-07";

function contractFileDate(file) {
  const match = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/.exec(normalized(file));
  return match ? match[1] : null;
}

/**
 * 「这条不变量归哪一层管、那一层有没有测试」——修完之后必须答的第三个问题（R21）。
 *
 * 为什么加它：合同已经逼你写清 symptom / direct_cause / class_root / prevention，
 * 但**没有一处逼你说出「这条不变量从此由谁守」**。于是「修在最早共享边界」经常落成
 * 一处补丁 + 一句承诺，而承诺没有 owner。填 `none` 是允许的诚实答案，代价是必须附一份
 * 结构工单——即「我知道没人管，工单在这」，而不是让它无声地变成没人管。
 */
function validateInvariantOwnerLayer(contract, existingFiles, label) {
  const errors = [];
  const owner = contract?.invariant_owner_layer;
  if (!record(owner)) {
    errors.push(`${label}: invariant_owner_layer is required (which layer owns this invariant, and does that layer have tests); use layer "none" plus structural_ticket if nobody owns it yet`);
    return errors;
  }
  if (!nonEmptyText(owner.layer)) {
    errors.push(`${label}: invariant_owner_layer.layer must name the owning layer (a path or module), or the literal "none"`);
  } else if (owner.layer !== "none" && !pathExists(owner.layer, existingFiles)) {
    errors.push(`${label}: invariant_owner_layer.layer does not exist: ${owner.layer}`);
  }
  if (!Array.isArray(owner.tests)) {
    errors.push(`${label}: invariant_owner_layer.tests must be an array (empty means that layer has no tests, which requires a structural_ticket)`);
    return errors;
  }
  for (const testFile of owner.tests) {
    if (!nonEmptyText(testFile) || !isTestFile(normalized(testFile))) {
      errors.push(`${label}: invariant_owner_layer.tests entry is not a test file: ${testFile}`);
      continue;
    }
    if (!fileExists(testFile, existingFiles)) {
      errors.push(`${label}: invariant_owner_layer test does not exist: ${testFile}`);
    }
  }
  const needsTicket = owner.layer === "none" || owner.tests.length === 0;
  if (!needsTicket) return errors;
  if (!nonEmptyText(owner.structural_ticket)) {
    errors.push(`${label}: invariant_owner_layer requires structural_ticket when the owning layer is "none" or has no tests (an unowned invariant is a structural debt, not a detail)`);
  } else if (!pathExists(owner.structural_ticket, existingFiles)) {
    errors.push(`${label}: invariant_owner_layer.structural_ticket does not exist: ${owner.structural_ticket}`);
  }
  return errors;
}

/**
 * 「这条不变量碰到的状态，一共有几扇门」——动生产代码之前必须先数的那一问（R21，2026-09-11）。
 *
 * 为什么加它：合同已经逼你写清 class_root 和 same_class_entry_points，但那两项都是**叙述**——
 * 作者说他扫过了，门岗只能核对格式。2026-09-11 一天里连着三簇 bug 是同一个形状：
 * **不变量只在一扇门上实现，另一个入口绕过去**（画布落地的 6 条写入路径、付费收据的两个装配点、
 * `SkillRecord` 的 8 条投影）。三次都被当成独立的一处 bug 单独修了一遍，因为修的人被任务书框在
 * 一个文件里：他看得见症状那扇门，看不见另外几扇——而「去数一遍」这件事在高负载下没有人做。
 *
 * `doors` 把它变成机器能核对的东西：每条 `{kind, path, line, symbol}` 都要 path 存在、
 * 该行真的提到该 symbol。门表用 `node scripts/door-map.mjs <mutator 符号或文件>` 生成，
 * 不是手写——手写的门表和「我扫过了」是同一种东西。
 *
 * `door_reduction` 问的是第二件事：**数完之后你把门合并了没有**。≥2 扇而一扇没减，
 * 必须写 `why_not`——允许不减（有时确实不该减），但不允许无声地不减。
 */
export const DOOR_MAP_SINCE = "2026-09-11";

const DOOR_KINDS = new Set(["write", "read"]);
/**
 * 门只存在于 App 自己的状态代码里。门岗脚本、文档、测试改了不必进门表——
 * 它们不是「这个状态的入口」，把它们也收进来只会让作者为了过闸往门表里塞无关文件，
 * 而一张塞满无关文件的门表等于没有门表。
 */
const DOOR_ROOTS = ["src/", "electron/"];

function isDoorGovernedFile(file) {
  const name = normalized(file);
  if (isTestFile(name) || name.endsWith(".md") || name.endsWith(".json")) return false;
  return DOOR_ROOTS.some((root) => name.startsWith(root));
}

function lineMentionsSymbol(source, line, symbol) {
  const text = String(source).split("\n")[line - 1];
  return typeof text === "string" && text.includes(symbol);
}

function validateDoorMap(contract, changed, existingFiles, label, fileContents) {
  const errors = [];
  const scopePaths = Array.isArray(contract?.scope_paths) ? contract.scope_paths : [];
  const doors = contract?.doors;
  const doorPaths = new Set();

  if (!Array.isArray(doors) || doors.length === 0) {
    errors.push(`${label}: doors is required — 列出这条不变量碰到的状态的全部写入口与读入口`
      + `，每条 {kind:"write"|"read", path, line, symbol}；用 \`node scripts/door-map.mjs <mutator 符号或文件>\` 生成，别手写`);
  } else {
    for (const door of doors) {
      if (!record(door) || !DOOR_KINDS.has(door.kind) || !nonEmptyText(door.path)
        || !Number.isInteger(door.line) || door.line < 1 || !nonEmptyText(door.symbol)) {
        errors.push(`${label}: every doors entry requires kind "write" or "read", path, a positive integer line, and symbol`);
        continue;
      }
      const clean = normalized(door.path);
      doorPaths.add(clean);
      if (!fileExists(clean, existingFiles)) {
        errors.push(`${label}: door path does not exist: ${door.path}`);
        continue;
      }
      const source = fileContent(clean, fileContents);
      if (typeof source !== "string") {
        errors.push(`${label}: door cannot be verified because file contents are unavailable: ${door.path}`);
      } else if (!lineMentionsSymbol(source, door.line, door.symbol.trim())) {
        errors.push(`${label}: door does not resolve — ${door.path}:${door.line} does not mention ${door.symbol}`
          + `（修完之后行号会动：重跑 node scripts/door-map.mjs 取当前门表）`);
      }
    }
  }

  const reduction = contract?.door_reduction;
  if (!record(reduction) || !Number.isInteger(reduction.before) || reduction.before < 0
    || !Number.isInteger(reduction.after) || reduction.after < 0) {
    errors.push(`${label}: door_reduction requires integer before/after (修之前几扇门、修之后还剩几扇)`);
  } else {
    if (Array.isArray(doors) && doors.length > 0 && reduction.after !== doors.length) {
      errors.push(`${label}: door_reduction.after (${reduction.after}) must equal doors.length (${doors.length})`
        + ` —— doors 记的是修完之后还剩下的门`);
    }
    if (reduction.before >= 2 && reduction.after >= reduction.before && !nonEmptyText(reduction.why_not)) {
      errors.push(`${label}: door_reduction.why_not is required — ${reduction.before} 扇门一扇没减`
        + `，允许不减但不允许无声地不减（说清为什么这些入口必须各自存在）`);
    }
  }

  const strays = [...changed]
    .filter((file) => isDoorGovernedFile(file) && pathIsInScope(file, scopePaths) && !doorPaths.has(normalized(file)))
    .sort();
  for (const file of strays) {
    errors.push(`${label}: changed production file is not in the door map: ${file}`
      + `（改了门表之外的文件 = 门没数全，或者这份合同的 scope_paths 画大了）`);
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
  const fileDate = contractFileDate(contract?.__file);
  if (fileDate && fileDate >= INVARIANT_OWNER_LAYER_SINCE) {
    errors.push(...validateInvariantOwnerLayer(contract, existingFiles, label));
  }
  if (fileDate && fileDate >= DOOR_MAP_SINCE) {
    errors.push(...validateDoorMap(contract, changed, existingFiles, label, fileContents));
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
