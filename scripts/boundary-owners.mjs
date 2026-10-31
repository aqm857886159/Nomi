// 读根因合同里 `shared_boundaries` 声明的 owner，核对「这个主人今天是不是还在那儿」。
//
// 判据只从合同现读，本模块不另存一份 owner 名单——另写一份就又是一个手抄真相源，
// 正是这批合同要消灭的东西。台账（boundary-owners-ledger.json）只对**已声明**的条目
// 做三种处置：搬家了（换个地方接着核）／退役了（写明理由）／还没查（棘轮只减不增），
// 它不能凭空增加一个 owner。台账只有 readLedger 一个读口，「搬家了」只有 reanchorResolver 一种读法：
// check:concept-owners 核合同边界是不是写接口时也经它，两道门对同一条边界核的是同一个锚。
//
// 「主人还在原地」有两档，按这条边界有没有登记改锚分：
//   · 没登记改锚：旧锚的文件里还有这个词（resolveSymbol）就算在位；
//   · 登记了改锚：要旧锚今天还**定义**着它（ownerDefinedAt）。定义搬走、旧文件还 import / 调用，词在、定义不在，
//     那是搬了家，不是台账条目自己好了——这时接着核新锚。
// 「谁定义了这个符号」只有 concept-owners-scan 的 collectDefinitions（TypeScript 解析）一个答案，check:concept-owners 也用它。
import fs from "node:fs";
import path from "node:path";
import { collectDefinitions, isScannableSource } from "./concept-owners-scan.mjs";

export const VERDICT = {
  OK: "ok",
  PATH_MISSING: "path-missing",
  SYMBOL_MISSING: "symbol-missing",
  UNREADABLE: "unreadable-symbol",
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*(?:\(\))?$/;
const SYMBOL_SEPARATORS = /\s+and\s+|\s+plus\s+|\s*\/\s*|\s*,\s*|\s*\+\s*|\s+与\s+|、/;

export function splitSymbol(symbol) {
  return String(symbol).split(SYMBOL_SEPARATORS).map((part) => part.trim()).filter(Boolean);
}

/** JS 标识符的词边界：前后都不能再接标识符字符，否则 `foo` 会被 `fooBar` 冒充。 */
export function hasWord(text, name) {
  return new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$])`).test(text);
}

function identifierHead(part) {
  const match = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(part.replace(/\(\)$/, ""));
  return match ? match[1] : part;
}

/** symbol 整串拆开后每一段都长得像标识符，就返回各段；否则返回 null（字面量写法，或根本读不了）。 */
function identifierParts(symbol) {
  const parts = splitSymbol(symbol);
  return parts.length > 0 && parts.every((part) => IDENTIFIER.test(part)) ? parts : null;
}

/**
 * 三层解析，从最不会误判的一层开始：
 *  1. 整串拆开后每一段都长得像标识符 —— 逐段按**词边界**核。
 *     不能用 includes 子串：`assertSafeUrl` 改名成 `assertSafeUrlV2` 时子串仍然命中，
 *     门岗会假绿——这正是变异测试第一次跑出来的那个洞。
 *  2. 不是标识符，但整串字面量在文件里原样出现 —— 覆盖 `check:standard-formats`、
 *     `data-project-id`、`tab === 'file'` 这类完全可核的写法，零误判。
 *  3. 都不是 —— 判为「机器读不了」，进普查，不判红也不静默跳过。
 */
export function resolveSymbol(symbol, text) {
  const parts = identifierParts(symbol);
  if (parts) {
    const missing = parts.filter((part) => !hasWord(text, identifierHead(part)));
    return missing.length ? { verdict: VERDICT.SYMBOL_MISSING, missing } : { verdict: VERDICT.OK, missing: [] };
  }
  if (text.includes(String(symbol).trim())) return { verdict: VERDICT.OK, missing: [] };
  return { verdict: VERDICT.UNREADABLE, missing: [] };
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else out.push(child);
  }
}

const cleanBoundaryPath = (boundaryPath) => String(boundaryPath).replace(/\/\*\*$/, "").replace(/\/\*$/, "").replace(/\/$/, "");

/** 把一条 boundary 的 path 读成「用来找符号的那段文本」。目录/通配符展开成其下全部文件。 */
export function readBoundaryText(repoRoot, boundaryPath) {
  const cleaned = cleanBoundaryPath(boundaryPath);
  const absolute = path.join(repoRoot, cleaned);
  let stat;
  try { stat = fs.statSync(absolute); } catch { return null; }
  if (stat.isFile()) {
    try { return fs.readFileSync(absolute, "utf8"); } catch { return null; }
  }
  const files = [];
  walk(absolute, files);
  if (files.length === 0) return null;
  return files.map((file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }).join("\n");
}

/** 一条 boundary 的 path 展开成其下的文件（相对仓库根、用 / 分隔）：文件就是它自己，目录/通配符展开成其下全部文件；路径不在返回 null。 */
function boundaryFiles(repoRoot, boundaryPath) {
  const cleaned = cleanBoundaryPath(boundaryPath);
  const absolute = path.join(repoRoot, cleaned);
  let stat;
  try { stat = fs.statSync(absolute); } catch { return null; }
  if (stat.isFile()) return [cleaned];
  const files = [];
  walk(absolute, files);
  return files.map((file) => path.relative(repoRoot, file).split(path.sep).join("/"));
}

export function boundaryIdentity(entry) {
  return `${entry.contract}::${entry.path}::${entry.symbol}`;
}

export const LEDGER_PATH = "scripts/boundary-owners-ledger.json";

const isText = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * 台账的唯一读口：两道门（check:boundary-owners、check:concept-owners）都经它拿台账，别处不另读这个文件。
 * 读不到、根不是对象、改锚条目没写全新锚、退役条目没写理由，都在这里抛错、由入口报红——新锚写空了，哪道门都不能悄悄算它在位；
 * 退役是「这条不变量不再适用」的声明，没有理由的声明等于没有人为它负责。
 */
export function readLedger(repoRoot) {
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(path.join(repoRoot, LEDGER_PATH), "utf8"));
  } catch (error) {
    throw new Error(`边界主人台账 ${LEDGER_PATH} 读不了：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger) || !Array.isArray(ledger.reanchored ?? []) || !Array.isArray(ledger.retirements ?? [])) {
    throw new Error(`边界主人台账 ${LEDGER_PATH} 的根必须是对象，reanchored 与 retirements 必须是数组`);
  }
  const halfAnchored = (ledger.reanchored ?? []).filter((row) => !isText(row?.anchor?.path) || !isText(row?.anchor?.symbol));
  if (halfAnchored.length) {
    throw new Error(`边界主人台账 ${LEDGER_PATH} 的 reanchored 条目要写全新锚 anchor: { path, symbol }：${halfAnchored.map((row) => boundaryIdentity(row || {})).join("、")}`);
  }
  const unexplained = (ledger.retirements ?? []).filter((row) => !isText(row?.reason));
  if (unexplained.length) {
    throw new Error(`边界主人台账 ${LEDGER_PATH} 的 retirements 条目要写理由 reason（那条不变量为什么不再适用）：${unexplained.map((row) => boundaryIdentity(row || {})).join("、")}`);
  }
  return ledger;
}

/**
 * 改锚解析：「合同声明的边界挪走了」只记在台账 reanchored 一处（合同是立约当天的快照，不改），这里是它唯一的读法，
 * 两道门共用——check:boundary-owners 的 evaluate 拿它接着核新锚还在不在，check:concept-owners 的 evaluateContracts
 * 拿它核新锚是不是某个概念的写接口。
 *   resolve(合同里声明的一条边界 { contract, path, symbol })：按 合同::路径::symbol 整串认（和台账条目同一个身份）；
 *   台账登记了就返回登记的新锚，declared 带着合同里的旧锚（报错要写「旧锚 → 新锚」）；没登记原样返回，declared 为 null。
 *   rows：登记过的条目（evaluate 拿它判「台账指向的边界合同里已经没有了」）。
 */
export function reanchorResolver(ledger) {
  const rows = new Map((ledger?.reanchored || []).map((row) => [boundaryIdentity(row), row]));
  return {
    rows,
    resolve(boundary) {
      const row = rows.get(boundaryIdentity(boundary));
      if (!row) return { contract: boundary.contract, path: boundary.path, symbol: boundary.symbol, declared: null };
      return {
        contract: boundary.contract,
        path: row.anchor.path,
        symbol: row.anchor.symbol,
        declared: { path: boundary.path, symbol: boundary.symbol },
      };
    },
  };
}

/**
 * 台账 retirements：主人确实没了、那条不变量不再适用。两道门读同一份：
 * check:boundary-owners 核主人真的不在（还在就报「台账条目已经自己好了」），check:concept-owners 在退役有凭据时
 * （retirementHasProof）不再要求它是写接口。
 */
export function retiredBoundaries(ledger) {
  return new Map((ledger?.retirements || []).map((row) => [boundaryIdentity(row), row]));
}

/**
 * 退役凭据（2026-10-31，验收 V-relay-protocol 的 B1）。退役说的是「这条边界的主人没了」——前提是它**曾经在**。
 * check:boundary-owners 只核「主人今天不在」，而一个从来没存在过的符号天然「不在」：于是「新合同声明一个不存在的符号 +
 * 台账记一行退役」让两道门同时放行，「新合同的共享边界必须登记」那道闸就只剩一行台账的厚度（真符号写到它不在的文件，同理）。
 * 凭据只看棘轮参照提交（check:concept-owners 的 loadReference 那一个），不看今天这棵树自己怎么说：
 *  · 参照提交的台账已经记着这一行 → 是历史，照旧认；
 *  · 今天才冒出来的行 → 参照提交上那份合同已经声明过这条边界，且符号当时确实在那个文件里（resolveSymbol，同一套词匹配）。
 * 缺一条，概念门就当它没退役，按未登记报。`source` 是参照提交的只读视图（concept-owners-scan 的 gitRefSource：read / listAll），
 * 用到才建——台账里没有新行时一次多余的读取都没有。
 */
export function retirementHasProof(row, { retiredAtRef, source }) {
  if (retiredAtRef.has(boundaryIdentity(row))) return true;
  const atRef = source();
  let contract = null;
  try { contract = JSON.parse(atRef.read(row.contract) ?? "null"); } catch { return false; }
  const declared = (Array.isArray(contract?.shared_boundaries) ? contract.shared_boundaries : [])
    .some((boundary) => boundary?.path === row.path && boundary?.symbol === row.symbol);
  if (!declared) return false;
  const cleaned = cleanBoundaryPath(row.path);
  const files = atRef.read(cleaned) !== null ? [cleaned] : atRef.listAll().filter((file) => file.startsWith(`${cleaned}/`));
  if (files.length === 0) return false;
  return resolveSymbol(row.symbol, files.map((file) => atRef.read(file) ?? "").join("\n")).verdict === VERDICT.OK;
}

export function readContracts(repoRoot) {
  const dir = path.join(repoRoot, "docs", "fixes");
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  const seen = new Set();
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".root-cause.json")).sort()) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); } catch { continue; }
    for (const boundary of Array.isArray(parsed?.shared_boundaries) ? parsed.shared_boundaries : []) {
      if (!boundary?.path || !boundary?.symbol) continue;
      const entry = { contract: `docs/fixes/${file}`, path: String(boundary.path), symbol: String(boundary.symbol) };
      const identity = boundaryIdentity(entry);
      if (seen.has(identity)) continue;
      seen.add(identity);
      entries.push(entry);
    }
  }
  return entries;
}

/** 核一条：主人还在不在那个路径上。 */
export function checkBoundary(repoRoot, entry, cache = new Map()) {
  let text = cache.get(entry.path);
  if (text === undefined) { text = readBoundaryText(repoRoot, entry.path); cache.set(entry.path, text); }
  if (text === null) return { ...entry, verdict: VERDICT.PATH_MISSING, missing: [] };
  const resolved = resolveSymbol(entry.symbol, text);
  return { ...entry, verdict: resolved.verdict, missing: resolved.missing };
}

export function auditBoundaries(repoRoot, entries = readContracts(repoRoot)) {
  const cache = new Map();
  return entries.map((entry) => checkBoundary(repoRoot, entry, cache));
}

/**
 * 这条边界的主人今天是不是**定义**在 entry.path 上——和「文件里有这个词」是两回事：定义搬走、旧文件还 import / 调用它，
 * 词在、定义不在。判法就是 check:concept-owners 的 evaluateOwnership 判「写接口在不在」的那一个：
 * 标识符写法 + 可扫描源码 → 看 collectDefinitions（TypeScript 解析）在这些文件里找没找到定义，
 * import、调用、别名、重导出、环境声明、注释和字符串里的名字都不算。多段 symbol 要每一段都还定义在原地（和 resolveSymbol 同为「全部」）。
 * 没有「定义」可判的——symbol 是字面量写法，或路径下没有可扫描的源码（测试、夹具、类型声明、非代码文件）——
 * 沿用 resolveSymbol 的文本命中，和 evaluateOwnership 的 else 分支同一个口径。
 */
export function ownerDefinedAt(repoRoot, entry) {
  const parts = identifierParts(entry.symbol);
  const files = parts ? boundaryFiles(repoRoot, entry.path)?.filter((file) => isScannableSource(file)) : null;
  if (!files?.length) return checkBoundary(repoRoot, entry).verdict === VERDICT.OK;
  const heads = [...new Set(parts.map(identifierHead))];
  const definitions = collectDefinitions({
    files,
    read: (file) => { try { return fs.readFileSync(path.join(repoRoot, file), "utf8"); } catch { return null; } },
    symbols: heads,
  });
  return heads.every((head) => (definitions.get(head) ?? []).length > 0);
}

/**
 * 台账裁决。规则对称：**台账条目陈旧（该条已经自己好了）同样判红**，
 * 否则台账会永远记着一堆早就不成立的豁免，变成另一处「以为有人在管」。
 * 登记了改锚的条目，「自己好了」= 旧锚今天又定义着它（ownerDefinedAt）；旧文件只剩 import / 调用，是主人搬了家，接着核新锚。
 */
export function evaluate({ results, ledger }) {
  const reanchor = reanchorResolver(ledger);
  const retirements = retiredBoundaries(ledger);
  const unverified = new Map((ledger?.unverified || []).map((row) => [boundaryIdentity(row), row]));
  const unreadable = new Map((ledger?.unreadable_symbols || []).map((row) => [boundaryIdentity(row), row]));

  const errors = [];
  const stats = { total: results.length, ok: 0, reanchored: 0, retired: 0, unverified: 0, unreadable: 0, broken: 0 };
  const live = new Set(results.map(boundaryIdentity));
  const cache = new Map();
  const repoRoot = ledger?.__repoRoot;

  for (const result of results) {
    const identity = boundaryIdentity(result);
    const anchor = reanchor.resolve(result);
    const inLedger = anchor.declared !== null || retirements.has(identity) || unverified.has(identity);

    if (result.verdict === VERDICT.UNREADABLE) {
      if (!unreadable.has(identity)) {
        errors.push(`合同写了机器读不了的 symbol，且没进普查表：${identity}\n    → symbol 要写成标识符（可用 / , and 分隔），或写成文件里能原样搜到的字面量`);
      }
      stats.unreadable += 1;
      continue;
    }
    if (unreadable.has(identity)) {
      errors.push(`普查表条目已经可读了，请从 unreadable_symbols 删掉（棘轮只减不增）：${identity}`);
    }

    // 主人还在原地：没登记改锚的边界，词还在就算（resolveSymbol）；登记了改锚的，要旧锚今天还**定义**着它。
    const ownerStays = result.verdict === VERDICT.OK && (anchor.declared === null || ownerDefinedAt(repoRoot, result));
    if (ownerStays) {
      stats.ok += 1;
      if (inLedger) {
        errors.push(`台账条目已经自己好了，请从台账删掉（棘轮只减不增）：${identity}`);
      }
      continue;
    }

    // 到这里 = 声明过的主人不在原地了（词没了，或定义搬走了）；台账登记过改锚，就接着核新锚
    if (anchor.declared) {
      const moved = checkBoundary(repoRoot, anchor, cache);
      if (moved.verdict === VERDICT.OK) { stats.reanchored += 1; continue; }
      errors.push(`改锚登记指向的新主人也不在了：${identity}\n    → 登记的新锚 ${anchor.path} :: ${anchor.symbol}（${moved.verdict}）`);
      stats.broken += 1;
      continue;
    }
    if (retirements.has(identity)) { stats.retired += 1; continue; }
    if (unverified.has(identity)) { stats.unverified += 1; continue; }

    stats.broken += 1;
    const detail = result.verdict === VERDICT.PATH_MISSING
      ? `路径不存在：${result.path}`
      : `符号不在那个文件里：${result.missing.join(" / ")}`;
    errors.push(`合同声明过的主人不在了：${identity}\n    → ${detail}`);
  }

  for (const [identity, bucket] of [
    ...[...reanchor.rows.keys()].map((k) => [k, "reanchored"]),
    ...[...retirements.keys()].map((k) => [k, "retirements"]),
    ...[...unverified.keys()].map((k) => [k, "unverified"]),
    ...[...unreadable.keys()].map((k) => [k, "unreadable_symbols"]),
  ]) {
    if (!live.has(identity)) errors.push(`台账 ${bucket} 指向一条合同里已经没有的边界，请删掉：${identity}`);
  }

  return { ok: errors.length === 0, errors, stats };
}
