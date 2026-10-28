import { makeTempDir } from './_test-temp.mjs'
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEDGER_PATH, VERDICT, auditBoundaries, checkBoundary, evaluate, hasWord, readContracts, readLedger, reanchorResolver, resolveSymbol } from "./boundary-owners.mjs";

function sandbox(files) {
  const root = makeTempDir("boundary-owners-");
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

test("词边界：foo 不许被 fooBar 冒充", () => {
  assert.equal(hasWord("const fooBar = 1", "foo"), false);
  assert.equal(hasWord("const foo = 1", "foo"), true);
  // 这是第一次变异测试暴露出来的洞：用 includes 子串时 assertSafeUrlV2 会让 assertSafeUrl 假绿。
  assert.equal(resolveSymbol("assertSafeUrl", "const assertSafeUrlV2 = 1").verdict, VERDICT.SYMBOL_MISSING);
});

test("非标识符但能原样搜到的字面量算在位", () => {
  assert.equal(resolveSymbol("check:standard-formats", 'scripts: { "check:standard-formats": "node x" }').verdict, VERDICT.OK);
  assert.equal(resolveSymbol("data-project-id", '<div data-project-id="1" />').verdict, VERDICT.OK);
});

test("机器读不了的 symbol 既不判在位也不判缺失", () => {
  assert.equal(resolveSymbol("public community links resolve to a real GitHub surface", "anything").verdict, VERDICT.UNREADABLE);
});

test("多段 symbol 逐段核，缺一段就算缺", () => {
  const r = resolveSymbol("alpha / beta", "export const alpha = 1");
  assert.equal(r.verdict, VERDICT.SYMBOL_MISSING);
  assert.deepEqual(r.missing, ["beta"]);
});

test("路径不存在与符号不在，分别报不同判据", () => {
  const root = sandbox({ "a.ts": "export const kept = 1\n" });
  assert.equal(checkBoundary(root, { contract: "c", path: "gone.ts", symbol: "kept" }).verdict, VERDICT.PATH_MISSING);
  assert.equal(checkBoundary(root, { contract: "c", path: "a.ts", symbol: "vanished" }).verdict, VERDICT.SYMBOL_MISSING);
  assert.equal(checkBoundary(root, { contract: "c", path: "a.ts", symbol: "kept" }).verdict, VERDICT.OK);
});

test("判据从合同现读，不从另一份 owner 名单读", () => {
  const root = sandbox({
    "docs/fixes/x.root-cause.json": JSON.stringify({
      shared_boundaries: [{ path: "a.ts", symbol: "owner", responsibility: "r" }],
    }),
  });
  assert.deepEqual(readContracts(root), [{ contract: "docs/fixes/x.root-cause.json", path: "a.ts", symbol: "owner" }]);
});

const ENTRY = { contract: "c", path: "a.ts", symbol: "owner" };

test("没进台账的坏边界直接判红", () => {
  const out = evaluate({ results: [{ ...ENTRY, verdict: VERDICT.PATH_MISSING, missing: [] }], ledger: {} });
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /声明过的主人不在了/);
});

test("改锚登记会接着核新锚——新锚也坏了照样红", () => {
  const root = sandbox({ "new.ts": "export const moved = 1\n" });
  const broken = [{ ...ENTRY, verdict: VERDICT.PATH_MISSING, missing: [] }];
  const good = evaluate({ results: broken, ledger: { __repoRoot: root, reanchored: [{ ...ENTRY, anchor: { path: "new.ts", symbol: "moved" }, reason: "搬了" }] } });
  assert.equal(good.ok, true);
  const bad = evaluate({ results: broken, ledger: { __repoRoot: root, reanchored: [{ ...ENTRY, anchor: { path: "new.ts", symbol: "notThere" }, reason: "搬了" }] } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join("\n"), /改锚登记指向的新主人也不在了/);
});

test("退役与待查放行，但台账条目自己好了必须删掉（棘轮只减不增）", () => {
  const retired = evaluate({ results: [{ ...ENTRY, verdict: VERDICT.PATH_MISSING, missing: [] }], ledger: { retirements: [{ ...ENTRY, reason: "没了" }] } });
  assert.equal(retired.ok, true);
  const stale = evaluate({ results: [{ ...ENTRY, verdict: VERDICT.OK, missing: [] }], ledger: { retirements: [{ ...ENTRY, reason: "没了" }] } });
  assert.equal(stale.ok, false);
  assert.match(stale.errors.join("\n"), /台账条目已经自己好了/);
});

test("台账指向合同里已不存在的边界要删掉", () => {
  const out = evaluate({ results: [], ledger: { unverified: [{ contract: "gone", path: "p", symbol: "s", note: "n" }] } });
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /台账 unverified 指向一条合同里已经没有的边界/);
});

test("新合同写机器读不了的 symbol 会红；普查表条目变可读了也要删", () => {
  const fresh = evaluate({ results: [{ ...ENTRY, symbol: "一句中文说明", verdict: VERDICT.UNREADABLE, missing: [] }], ledger: {} });
  assert.equal(fresh.ok, false);
  assert.match(fresh.errors.join("\n"), /机器读不了的 symbol/);
  const staleCensus = evaluate({ results: [{ ...ENTRY, verdict: VERDICT.OK, missing: [] }], ledger: { unreadable_symbols: [ENTRY] } });
  assert.equal(staleCensus.ok, false);
  assert.match(staleCensus.errors.join("\n"), /普查表条目已经可读了/);
});

test("改锚解析：台账登记了就返回新锚并带着合同里的旧锚；没登记原样返回（按 合同::路径::symbol 整串认）", () => {
  const { resolve } = reanchorResolver({ reanchored: [{ ...ENTRY, anchor: { path: "new.ts", symbol: "moved" }, reason: "搬了" }] });
  assert.deepEqual(resolve(ENTRY), { contract: "c", path: "new.ts", symbol: "moved", declared: { path: "a.ts", symbol: "owner" } });
  const wider = { contract: "c", path: "a.ts", symbol: "owner / second" };
  assert.deepEqual(resolve(wider), { ...wider, declared: null });
  assert.deepEqual(reanchorResolver(undefined).resolve(ENTRY), { ...ENTRY, declared: null });
});

test("台账读口：读不到、根不是对象、改锚条目没写全新锚，都在读的时候红", () => {
  assert.throws(() => readLedger(sandbox({})), /scripts\/boundary-owners-ledger\.json/);
  assert.throws(() => readLedger(sandbox({ [LEDGER_PATH]: "[]" })), /根必须是对象/);
  const halfAnchor = { reanchored: [{ ...ENTRY, anchor: { path: "new.ts", symbol: "" }, reason: "搬了" }] };
  assert.throws(() => readLedger(sandbox({ [LEDGER_PATH]: JSON.stringify(halfAnchor) })), /c::a\.ts::owner/);
  const whole = { reanchored: [{ ...ENTRY, anchor: { path: "new.ts", symbol: "moved" }, reason: "搬了" }] };
  assert.deepEqual(readLedger(sandbox({ [LEDGER_PATH]: JSON.stringify(whole) })), whole);
});

test("台账只有一个读口：scripts 里认得台账路径的生产脚本只有 boundary-owners.mjs（别的门岗要读台账只能经 readLedger）", () => {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const readers = fs.readdirSync(scriptsDir, { recursive: true })
    .map((rel) => String(rel).split(path.sep).join("/"))
    .filter((rel) => /\.(?:mjs|cjs|js)$/.test(rel) && !/\.(?:node-test|test)\.[cm]?js$/.test(rel) && !rel.split("/").includes("node_modules"))
    .filter((rel) => fs.readFileSync(path.join(scriptsDir, rel), "utf8").includes("boundary-owners-ledger"));
  assert.deepEqual(readers, ["boundary-owners.mjs"]);
});

// ─── 主人搬家：定义原样搬进新文件，旧文件还 import / 调用着 ───────────────────────────────
// 特征测试：换判据之前先把现状钉住。①③ 是会被换掉的判法（词还在 = 主人还在，于是改锚条目被判「过期」），
// ②④ 是换了也必须原样不动的判法。
const MOVED_CONTRACT = "docs/fixes/2026-10-16-moved-definition.root-cause.json";
const OLD_FILE = "electron/tasks/taskResultQuery.ts";
const NEW_FILE = "electron/tasks/retrievalStageError.ts";
const DEFINES = "export function retrievalStageError(error: unknown) { return error; }\n";
/** 旧文件里只剩 import 和一次调用——定义已经搬走。 */
const IMPORTS_ONLY = 'import { retrievalStageError } from "./retrievalStageError";\nexport function readResult(error: unknown) { return retrievalStageError(error); }\n';
const MOVED_ROW = {
  contract: MOVED_CONTRACT,
  path: OLD_FILE,
  symbol: "retrievalStageError",
  anchor: { path: NEW_FILE, symbol: "retrievalStageError" },
  reason: "原样搬到独立文件，旧文件 import 着",
};

/** 一个最小仓库：一份合同声明了旧锚，台账登记了 rows，旧文件 / 新文件各自是给定的源码（newSource 为 null = 新文件不存在）。 */
function movedRepo({ oldSource, newSource = DEFINES, rows = [MOVED_ROW] }) {
  return sandbox({
    [MOVED_CONTRACT]: JSON.stringify({ shared_boundaries: [{ path: OLD_FILE, symbol: "retrievalStageError", responsibility: "r" }] }),
    [LEDGER_PATH]: JSON.stringify({ version: 1, reanchored: rows }),
    [OLD_FILE]: oldSource,
    ...(newSource === null ? {} : { [NEW_FILE]: newSource }),
  });
}

/** check-boundary-owners.mjs 做的整套事（读台账、读合同、逐条核、台账裁决），不起子进程。 */
function runGate(root) {
  const ledger = readLedger(root);
  ledger.__repoRoot = root;
  return evaluate({ results: auditBoundaries(root), ledger });
}

test("现状（特征）：定义搬走、旧文件还 import 着、台账登记了改锚 → 判「台账条目已经自己好了」", () => {
  const out = runGate(movedRepo({ oldSource: IMPORTS_ONLY }));
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /台账条目已经自己好了/);
});

test("现状（特征）：定义搬走、旧文件还 import 着、新锚也不在 → 同样只说「已经自己好了」，说不出新主人没了", () => {
  const out = runGate(movedRepo({ oldSource: IMPORTS_ONLY, newSource: null }));
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /台账条目已经自己好了/);
  assert.doesNotMatch(out.errors.join("\n"), /新主人也不在了/);
});

test("不变量：旧文件又把它定义回来 + 台账还登记着改锚 → 报过期", () => {
  const out = runGate(movedRepo({ oldSource: `${IMPORTS_ONLY}${DEFINES}` }));
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /台账条目已经自己好了/);
});

test("不变量：没登记改锚的边界，词还在（只剩 import）就是在位——口径不变", () => {
  const out = runGate(movedRepo({ oldSource: IMPORTS_ONLY, rows: [] }));
  assert.equal(out.ok, true, out.errors.join("\n"));
  assert.equal(out.stats.ok, 1);
  assert.equal(out.stats.reanchored, 0);
});
