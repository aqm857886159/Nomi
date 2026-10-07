#!/usr/bin/env node
// 形态契约门岗（2026-09-03）——防「忘了写契约」静默退回人眼对账（L0）。
//
// 背景：拍板样张是 HTML、实现是 React，两套代码描述同一个东西，中间靠人脑翻译 →
// 漂移是结构性的。`tests/ux/_contract.mjs` 把形态意图变成二值断言解决了「能不能查」，
// 但如果没人写契约、或写了没人跑，机制就等于不存在。本门岗守这两件事：
//   1. **有样张的功能面必须有契约文件**（`docs/design/mockups/contracts/<样张名>.{intent,auto}.mjs`）
//   2. **契约必须被至少一条走查引用**（写了不跑 = 装饰品）
//   3. **契约描述的必须还是现行那一版拍板**（2026-09-18 补）
//
// 第 3 条的由来：分镜表 v6（`0d5a56d47`，2026-09-06）重做了信息架构、同步更新了人读的设计合同，
// 却没迁机器契约。上面两条判据当时全绿——契约文件在、走查也引用了——而走查拿 v5 的数字去量 v6 的
// 界面，14 条里 4 条不符，**绿了 12 天**。缺的从来不是「有没有契约」，是「契约还对不对得上那份拍板」。
//
// 判据：每份契约声明 `mechanizes: { doc?, sections?, migratedAt }`。`doc` 是这份契约机械化的**获批正本**
// ——散文设计合同优先，缺省时正本就是 `mockup` 本身（有些面的拍板物就是样张）。v6 那份必须显式指向
// 散文合同，因为它同名的样张恰恰是被推翻的 v5。门岗比对正本**最后一次内容变更**的日期 vs `migratedAt`：
// 正本动了、契约没跟 → 红，并点名要重读哪几节。
//
// 日期只认 git 记录，**绝不用文件 mtime**：`git worktree add` 会把整棵树的 mtime 设成 checkout 那一刻，
// 用 mtime 会让每一棵新开的 worktree 整片翻红。
//
// 两层契约同规范：`*.intent.mjs`（拍板方手写的意图关系）/ `*.auto.mjs`（从样张导出的挂点/几何/token）。
// 任一层存在即算该样张有契约；两层都缺才算欠账。
//
// 棘轮：存量样张多数早于本机制，逐一补契约是独立工程。记基线、只减不增，新增样张必须带契约。
// 重记基线：`node ./scripts/check-mockup-contracts.mjs --baseline`

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCKUP_DIR = path.join(root, "docs", "design", "mockups");
const CONTRACT_DIR = path.join(MOCKUP_DIR, "contracts");
const WALK_DIR = path.join(root, "tests", "ux");
const baselinePath = path.join(root, "scripts", "mockup-contracts-baseline.json");
const htmlContractBaselinePath = path.join(root, "scripts", "mockup-contracts-html-baseline.json");

if (!fs.existsSync(MOCKUP_DIR)) {
  console.log("✅ 形态契约门岗：无 mockups 目录，跳过。");
  process.exit(0);
}

// 样张有两种形态：单个 `<名>.html`，或一个文件夹 `<名>/`（里面一页或多页 .html，常带截图和 README）。
// 2026-09-28 版本卡片样张是文件夹，门岗只认单文件 → 没被要求写契约、显示绿，实现和拍板差很远也没人红。
// 只有截图、没有 .html 的文件夹是「改完后的样子」存档，不是可交互样张，不算。
const mockups = fs
  .readdirSync(MOCKUP_DIR, { withFileTypes: true })
  .flatMap((e) => {
    if (e.isFile() && e.name.endsWith(".html")) return [e.name];
    if (e.isDirectory() && e.name !== "contracts"
      && fs.readdirSync(path.join(MOCKUP_DIR, e.name)).some((f) => f.endsWith(".html"))) {
      return [`${e.name}/`];
    }
    return [];
  })
  .sort();

const contracts = fs.existsSync(CONTRACT_DIR)
  ? fs.readdirSync(CONTRACT_DIR).filter((f) => /\.(intent|auto)\.mjs$/.test(f))
  : [];

// 契约自己声明它机械化的是哪份样张（`mockup` 字段）——按这个身份认领，不靠文件名猜。
const contractModules = new Map();
for (const c of contracts) {
  try {
    contractModules.set(c, (await import(pathToFileURL(path.join(CONTRACT_DIR, c)).href)).default);
  } catch (error) {
    contractModules.set(c, { __loadError: error });
  }
}
const claimedPaths = [...contractModules.values()]
  .flatMap((contract) => [contract?.mockup, contract?.mechanizes?.doc])
  .filter((p) => typeof p === "string" && p)
  .map((p) => p.replaceAll("\\", "/"));
const isClaimed = (mockup) => {
  const full = `docs/design/mockups/${mockup}`;
  return claimedPaths.some((p) => (mockup.endsWith("/") ? p.startsWith(full) : p === full));
};

// 走查全文（含子目录），用于判断契约有没有被引用。
function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, acc);
    else if (/\.(mjs|js|ts)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const walkText = walkFiles(WALK_DIR)
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

// 新合同的正本不再是另一套手画 HTML。HTML 仍可留作方向探索，但不能再充当验收合同；
// main 上已经存在的 HTML 合同进入只减不增的历史基线，避免一次规则升级把整棵旧树翻红。
const htmlContractBaseline = fs.existsSync(htmlContractBaselinePath)
  ? new Set(JSON.parse(fs.readFileSync(htmlContractBaselinePath, "utf8")))
  : new Set();

const isHtmlMockup = (mockup) => typeof mockup === "string" && mockup.endsWith(".html");
const isExploration = (contract) => contract?.layer === "exploration";

const { LAB_SCREEN_IDS, LAB_SCREENS: LAB_SCREEN_REGISTRY } = await import(
  pathToFileURL(path.join(root, "tests", "ux", "design-lab", "labStates.mjs")).href,
);
const labScreensSource = fs.readFileSync(path.join(root, "src", "devlab", "designLab", "labScreens.ts"), "utf8");
const registeredLabScreenIds = new Set(
  [...labScreensSource.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1]),
);

function resolveImportPath(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, path.join(base, "index.tsx"), path.join(base, "index.ts")];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function importsPath(source, importer, target) {
  const targetAbsolute = path.resolve(root, target);
  const imports = [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
  return imports.some((specifier) => resolveImportPath(importer, specifier) === targetAbsolute);
}

function stateSourceFor(screenId, stateId) {
  const config = LAB_SCREEN_REGISTRY[screenId];
  if (!config) return null;
  const files = fs.readdirSync(config.registryDir).filter((name) => name.endsWith(".tsx")).sort();
  for (const name of files) {
    const file = path.join(config.registryDir, name);
    const source = fs.readFileSync(file, "utf8");
    if (source.includes(`id: '${stateId}',`)) {
      return { file, source };
    }
  }
  return null;
}

function staticRegionIds(source) {
  return [...source.matchAll(/data-mockup-region\s*=\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

function validateLabContract(contract, name) {
  const errors = [];
  const lab = contract?.labScreen;
  if (!lab || typeof lab !== "object") return [`${name} 缺少 labScreen：新验收合同必须指向 labScreens.ts 登记的实验室屏`];
  if (typeof lab.id !== "string" || !registeredLabScreenIds.has(lab.id) || !LAB_SCREEN_IDS.includes(lab.id)) {
    errors.push(`${name} 的 labScreen.id「${lab.id ?? "(空)"}」不在 src/devlab/designLab/labScreens.ts 注册表`);
    return errors;
  }
  if (typeof lab.state !== "string") errors.push(`${name} 的 labScreen.state 必须指向一个登记状态`);
  const state = typeof lab.state === "string" ? stateSourceFor(lab.id, lab.state) : null;
  if (!state) {
    errors.push(`${name} 的 labScreen.state「${lab.state ?? "(空)"}」不在 ${lab.id} 的状态注册表`);
    return errors;
  }
  if (typeof lab.host !== "string" || !lab.host.startsWith("src/devlab/")) {
    errors.push(`${name} 的 labScreen.host 必须是 src/devlab/ 下的宿主文件`);
    return errors;
  }
  const hostPath = path.resolve(root, lab.host);
  if (!fs.existsSync(hostPath)) {
    errors.push(`${name} 的 labScreen.host 不存在：${lab.host}`);
    return errors;
  }
  const hostSource = fs.readFileSync(hostPath, "utf8");
  const hostSymbol = typeof lab.hostSymbol === "string" ? lab.hostSymbol : "ShellStage";
  if (!new RegExp(`(?:export\\s+)?function\\s+${hostSymbol}\\b|const\\s+${hostSymbol}\\s*=`).test(hostSource)) {
    errors.push(`${name} 的 labScreen.host 没有宿主符号 ${hostSymbol}`);
  }
  if (!importsPath(state.source, state.file, lab.host)) {
    errors.push(`${name} 的实验室状态没有 import 它声明的宿主 ${lab.host}`);
  }
  const stateStart = state.source.indexOf(`id: '${lab.state}'`);
  const nextState = state.source.indexOf("\n    id: '", stateStart + 1);
  const stateBlock = state.source.slice(stateStart, nextState < 0 ? state.source.length : nextState);
  const renderStart = stateBlock.indexOf("render:");
  const renderSource = renderStart >= 0 ? stateBlock.slice(renderStart) : "";
  if (!renderSource.includes(hostSymbol)) errors.push(`${name} 的状态没有通过 ${hostSymbol} 渲染`);
  const jsxTags = [...renderSource.matchAll(/<([A-Za-z][A-Za-z0-9_.]*)/g)].map((match) => match[1]);
  const customTags = jsxTags.filter((tag) => tag !== hostSymbol);
  if (customTags.length) {
    errors.push(`${name} 的状态在 devlab 另画 JSX（发现 ${[...new Set(customTags)].join(", ")}）；实验室只给真实宿主数据`);
  }
  const production = Array.isArray(lab.production) ? lab.production : [];
  if (!production.length) errors.push(`${name} 必须声明 labScreen.production（生产目录组件路径）`);
  for (const productionPath of production) {
    if (typeof productionPath !== "string" || productionPath.startsWith("src/devlab/") || !productionPath.startsWith("src/")) {
      errors.push(`${name} 的生产组件路径必须在 src/ 且不能落在 src/devlab/：${productionPath}`);
      continue;
    }
    const productionAbsolute = path.resolve(root, productionPath);
    if (!fs.existsSync(productionAbsolute)) {
      errors.push(`${name} 的生产组件不存在：${productionPath}`);
    } else if (!importsPath(hostSource, hostPath, productionPath)) {
      errors.push(`${name} 的宿主没有直接 import 生产组件 ${productionPath}`);
    }
  }
  const sourceForRegions = [state.source, hostSource, ...production.filter((p) => typeof p === "string" && fs.existsSync(path.resolve(root, p))).map((p) => fs.readFileSync(path.resolve(root, p), "utf8"))].join("\n");
  const regionIds = [...new Set(staticRegionIds(sourceForRegions))];
  const rows = Array.isArray(contract.reconciliation) ? contract.reconciliation : [];
  const rowIds = rows.map((row) => row?.region).filter((region) => typeof region === "string");
  if (!regionIds.length) errors.push(`${name} 的实验室屏没有 data-mockup-region 区域标记`);
  for (const region of regionIds) {
    if (rowIds.filter((id) => id === region).length !== 1) errors.push(`${name} 的区域 ${region} 必须在 reconciliation 里恰好有一行`);
  }
  for (const row of rows) {
    if (!row || typeof row.region !== "string" || !regionIds.includes(row.region)) errors.push(`${name} 的 reconciliation 有未知区域：${row?.region ?? "(空)"}`);
    if (!['match', 'difference', 'deferred'].includes(row?.status)) errors.push(`${name} 的 reconciliation.${row?.region ?? "?"}.status 必须是 match / difference / deferred`);
    if (row?.status === 'difference' && typeof row.reason !== 'string') errors.push(`${name} 的区域 ${row.region} 标为 difference 时必须写 reason`);
    if (row?.status === 'deferred' && typeof row.target !== 'string') errors.push(`${name} 的区域 ${row.region} 标为 deferred 时必须写 target`);
    if (typeof row?.selector !== 'string' || !/^\[data-[^=]+="[^"]+"\]$/.test(row.selector)) errors.push(`${name} 的区域 ${row?.region ?? "?"} 必须给 data-* selector`);
  }
  return errors;
}

const invalidLabContracts = [];
const invalidExplorationContracts = [];
for (const c of contracts) {
  const contract = contractModules.get(c);
  if (contract?.__loadError) continue;
  const html = isHtmlMockup(contract?.mockup);
  const grandfatheredHtml = html && htmlContractBaseline.has(c);
  if (html && !grandfatheredHtml && !isExploration(contract)) {
    invalidLabContracts.push(`${c}：新 HTML 样张只能标 layer: 'exploration'，不能作验收合同`);
    continue;
  }
  if (isExploration(contract)) {
    if (walkText.includes(c) || walkText.includes(c.replace(/\.mjs$/, ""))) {
      invalidExplorationContracts.push(`${c}：exploration 契约不能被验收走查引用`);
    }
    continue;
  }
  if (!grandfatheredHtml) invalidLabContracts.push(...validateLabContract(contract, c));
}

const missing = []; // 样张没有任何契约文件
const unused = []; // 契约文件没被任何走查引用

for (const mockup of mockups) {
  // 旧契约可能没写 mockup 字段：退回按文件名认领（单文件 `<名>.`，文件夹 `<名>.` 或 `<名>-<面>.`）。
  const folder = mockup.endsWith("/");
  const base = folder ? mockup.slice(0, -1) : mockup.replace(/\.html$/, "");
  const named = contracts.some((c) => c.startsWith(`${base}.`) || (folder && c.startsWith(`${base}-`)));
  if (!isClaimed(mockup) && !named) missing.push(mockup);
}
for (const c of contracts) {
  if (!walkText.includes(c) && !walkText.includes(c.replace(/\.mjs$/, ""))) unused.push(c);
}

/** 正本最后一次**内容变更**的日期（YYYY-MM-DD）。没有 git 记录 → undefined（不红，见下）。 */
function lastChangedOn(relPath) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", relPath], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

const stale = []; // 正本动了、契约没跟
const undated = []; // 没声明 mechanizes.migratedAt —— 等于没人说过它对过哪一版
const dangling = []; // mechanizes.doc 指向不存在的文件

for (const c of contracts) {
  const contract = contractModules.get(c);
  if (contract?.__loadError) {
    dangling.push({ contract: c, why: `读不出来：${contract.__loadError.message}` });
    continue;
  }
  const mechanizes = contract?.mechanizes;
  const migratedAt = mechanizes?.migratedAt;
  if (!migratedAt) {
    undated.push(c);
    continue;
  }
  // 正本：散文设计合同优先；缺省时样张自己就是拍板物。
  const authority = mechanizes?.doc ?? contract?.mockup;
  if (!authority || !fs.existsSync(path.join(root, authority))) {
    dangling.push({ contract: c, why: `正本不存在：${authority ?? "(没写 doc，contract.mockup 也是空的)"}` });
    continue;
  }
  const authorityDate = lastChangedOn(authority);
  // 没有 git 记录 = 正本和契约多半在同一个还没提交的改动里，判不了先后，不红。
  if (!authorityDate) continue;
  if (authorityDate > migratedAt) {
    stale.push({ contract: c, authority, authorityDate, migratedAt, sections: mechanizes?.sections ?? [] });
  }
}

if (process.argv.includes("--baseline")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(missing.sort(), null, 2)}\n`);
  console.log(`✅ 已记录基线：${missing.length} 张样张暂无形态契约`);
  process.exit(0);
}

const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : [];
const known = new Set(baseline);
const newlyMissing = missing.filter((m) => !known.has(m));
const cleared = baseline.filter((b) => !missing.includes(b));

let red = false;

if (invalidLabContracts.length) {
  red = true;
  console.error(`✖ ${invalidLabContracts.length} 份新验收合同没有落到真实实验室屏：`);
  for (const error of invalidLabContracts) console.error(`   ${error}`);
}

if (invalidExplorationContracts.length) {
  red = true;
  console.error(`\n✖ ${invalidExplorationContracts.length} 份 exploration 契约被验收走查引用：`);
  for (const error of invalidExplorationContracts) console.error(`   ${error}`);
  console.error("  → exploration 只能用于方向探索，不能进入验收合同链");
}

if (newlyMissing.length) {
  red = true;
  console.error(`✖ ${newlyMissing.length} 张新样张没有形态契约：`);
  for (const m of newlyMissing) console.error(`   docs/design/mockups/${m}`);
  console.error(
    "\n  → 新增样张必须同产契约（拍板那刻的人才知道哪些关系承载意图）：",
  );
  console.error(
    `     docs/design/mockups/contracts/<样张名>.intent.mjs —— 见同目录已有样本`,
  );
}

if (unused.length) {
  red = true;
  console.error(`\n✖ ${unused.length} 份契约没有被任何走查引用（写了不跑 = 装饰品）：`);
  for (const u of unused) console.error(`   docs/design/mockups/contracts/${u}`);
  console.error("\n  → 在对应走查里 import 并调用 assertMockupContract（入口在 tests/ux/_assert.mjs）。");
}

if (undated.length) {
  red = true;
  console.error(`\n✖ ${undated.length} 份契约没说它对过哪一版拍板：`);
  for (const u of undated) console.error(`   docs/design/mockups/contracts/${u}`);
  console.error("\n  → 加一段 mechanizes：");
  console.error("     mechanizes: { doc: '<获批设计合同路径，缺省即用 mockup>', sections: ['§…'], migratedAt: 'YYYY-MM-DD' }");
}

if (dangling.length) {
  red = true;
  console.error(`\n✖ ${dangling.length} 份契约的正本指不到东西：`);
  for (const d of dangling) console.error(`   ${d.contract} —— ${d.why}`);
}

if (stale.length) {
  red = true;
  console.error(`\n✖ ${stale.length} 份契约已经过期——它机械化的那份拍板在它之后又动过：`);
  for (const s of stale) {
    console.error(`   ${s.contract}`);
    console.error(`     正本 ${s.authority} 最后变更 ${s.authorityDate}，契约只对到 ${s.migratedAt}`);
    if (s.sections.length) console.error(`     契约自称覆盖：${s.sections.join("、")}`);
    console.error(`     → 读这段 diff：git log -p --since=${s.migratedAt} -- ${s.authority}`);
  }
  console.error("\n  → 逐条对着正本重誊，数字只许从正本抄、不许新编；确认无需改动也要把 migratedAt 改成今天");
  console.error("     （改日期的意思是「我读过那段 diff 了」，不是「让门岗闭嘴」——分镜表 v6 那次就是没人读，绿了 12 天）。");
}

if (red) process.exit(1);

console.log(
  `✅ 形态契约门岗通过：${contracts.length} 份契约全部被走查引用、且都对得上现行拍板；`
  + `欠契约样张 ${missing.length} 张（样张基线 ${baseline.length}；HTML 合同历史基线 ${htmlContractBaseline.size}，只减不增）${cleared.length ? `，本次补齐 ${cleared.length} 张` : ""}。`,
);
