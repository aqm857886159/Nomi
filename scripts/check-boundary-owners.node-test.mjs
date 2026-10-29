import { makeTempDir } from './_test-temp.mjs'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEDGER_PATH, VERDICT, auditBoundaries, checkBoundary, evaluate, hasWord, ownerDefinedAt, readContracts, readLedger, reanchorResolver, resolveSymbol } from "./boundary-owners.mjs";
import { evaluateOwnership } from "./concept-owners-lib.mjs";
import { collectDefinitions } from "./concept-owners-scan.mjs";

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
// 登记了改锚的边界，「主人还在原地」= 旧锚今天还**定义**着它。词在、定义不在，是搬了家，接着核新锚；
// 没登记改锚的边界仍按「文件里有这个词」。夹具是最小仓库（一份合同 + 一本台账 + 几个源文件），
// runGate 做的就是 check-boundary-owners.mjs 做的整套事，只是不起子进程。
const MOVED_CONTRACT = "docs/fixes/2026-10-16-moved-definition.root-cause.json";
const OLD_FILE = "electron/tasks/taskResultQuery.ts";
const NEW_FILE = "electron/tasks/retrievalStageError.ts";
const SYMBOL = "retrievalStageError";
const DEFINES = `export function ${SYMBOL}(error: unknown) { return error; }\n`;
/** 旧文件里只剩 import 和一次调用——定义已经搬走。 */
const IMPORTS_ONLY = `import { ${SYMBOL} } from "./${SYMBOL}";\nexport function readResult(error: unknown) { return ${SYMBOL}(error); }\n`;

const movedRow = ({ from = OLD_FILE, symbol = SYMBOL, to = NEW_FILE, toSymbol = symbol } = {}) => ({
  contract: MOVED_CONTRACT,
  path: from,
  symbol,
  anchor: { path: to, symbol: toSymbol },
  reason: "原样搬到独立文件，旧文件 import 着",
});

/** 一个最小仓库：一份合同声明了 boundary，台账登记了 rows，其余文件按 files 摆。 */
function movedRepo({ files, boundary = { path: OLD_FILE, symbol: SYMBOL }, rows = [movedRow()] }) {
  return sandbox({
    [MOVED_CONTRACT]: JSON.stringify({ shared_boundaries: [{ ...boundary, responsibility: "r" }] }),
    [LEDGER_PATH]: JSON.stringify({ version: 1, reanchored: rows }),
    ...files,
  });
}

/** 旧文件 / 新文件各是给定的源码（newSource 为 null = 新文件不存在）。 */
const movedPair = (oldSource, newSource = DEFINES, rows) =>
  movedRepo({ files: { [OLD_FILE]: oldSource, ...(newSource === null ? {} : { [NEW_FILE]: newSource }) }, rows });

/** check-boundary-owners.mjs 做的整套事（读台账、读合同、逐条核、台账裁决），不起子进程。 */
function runGate(root) {
  const ledger = readLedger(root);
  ledger.__repoRoot = root;
  return evaluate({ results: auditBoundaries(root), ledger });
}

test("① 定义原样搬走、旧文件还 import 并调用 → 判改锚在位，不报过期", () => {
  const out = runGate(movedPair(IMPORTS_ONLY));
  assert.equal(out.ok, true, out.errors.join("\n"));
  assert.equal(out.stats.reanchored, 1);
  assert.equal(out.stats.ok, 0);
});

test("② 旧文件又把它定义回来 + 台账还登记着改锚 → 报过期（新锚在不在都一样）", () => {
  for (const newSource of [DEFINES, null]) {
    const out = runGate(movedPair(`${IMPORTS_ONLY}${DEFINES}`, newSource));
    assert.equal(out.ok, false, `新锚${newSource === null ? "不在" : "也定义着"}`);
    assert.match(out.errors.join("\n"), /台账条目已经自己好了/);
    assert.equal(out.stats.reanchored, 0);
  }
});

test("③ 定义搬走、新锚也不在 → 报「新主人也不在了」，不再说「已经自己好了」", () => {
  // 新文件根本不在，和新文件在、但里面没有这个符号，是两种「新主人不在」。
  for (const newSource of [null, "export const unrelated = 1\n"]) {
    const out = runGate(movedPair(IMPORTS_ONLY, newSource));
    assert.equal(out.ok, false);
    assert.match(out.errors.join("\n"), /改锚登记指向的新主人也不在了/);
    assert.doesNotMatch(out.errors.join("\n"), /已经自己好了/);
    assert.equal(out.stats.broken, 1);
  }
});

test("④ 没登记改锚的边界，词还在（只剩 import）就是在位——口径不变", () => {
  const out = runGate(movedPair(IMPORTS_ONLY, DEFINES, []));
  assert.equal(out.ok, true, out.errors.join("\n"));
  assert.equal(out.stats.ok, 1);
  assert.equal(out.stats.reanchored, 0);
});

test("⑤ 旧符号已删、旧文件只在注释和字符串里还提到它 → 也是搬了家，不是台账条目自己好了", () => {
  const out = runGate(movedPair(`// 以前 ${SYMBOL} 住在这里，已经搬走\nexport const note = "${SYMBOL} 已搬家";\n`));
  assert.equal(out.ok, true, out.errors.join("\n"));
  assert.equal(out.stats.reanchored, 1);
});

test("⑥ 多段 symbol：有一段的定义搬走了，整条边界就不在原地，接着核新锚；每一段都还定义着才是自己好了", () => {
  const from = "electron/tasks/pair.ts";
  const to = "electron/tasks/beta.ts";
  const repo = (pair) => movedRepo({
    boundary: { path: from, symbol: "alpha and beta" },
    rows: [movedRow({ from, symbol: "alpha and beta", to, toSymbol: "beta" })],
    files: { [from]: pair, [to]: "export const beta = 1;\n" },
  });
  const betaMoved = runGate(repo('import { beta } from "./beta";\nexport const alpha = () => beta;\n'));
  assert.equal(betaMoved.ok, true, betaMoved.errors.join("\n"));
  assert.equal(betaMoved.stats.reanchored, 1);
  const bothHere = runGate(repo("export const alpha = 1;\nexport const beta = 2;\n"));
  assert.equal(bothHere.ok, false);
  assert.match(bothHere.errors.join("\n"), /台账条目已经自己好了/);
});

test("⑦ 字面量写法的 symbol 没有「定义」可判：旧锚文件里原样还在，台账条目就是自己好了（口径不变）", () => {
  const literal = "check:standard-formats";
  const out = runGate(movedRepo({
    boundary: { path: OLD_FILE, symbol: literal },
    rows: [movedRow({ symbol: literal, toSymbol: SYMBOL })],
    files: { [OLD_FILE]: `export const scripts = { "${literal}": "node x" };\n`, [NEW_FILE]: DEFINES },
  }));
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /台账条目已经自己好了/);
});

test("⑧ 旧锚是目录：目录下没有任何文件还定义着它 → 搬了家；有一个文件定义着 → 自己好了", () => {
  const dir = "electron/tasks";
  const outside = "electron/shared/retrievalStageError.ts"; // 新锚得在旧目录之外，否则它自己就算「目录下定义着」
  const repo = (extra) => movedRepo({
    boundary: { path: dir, symbol: SYMBOL },
    rows: [movedRow({ from: dir, to: outside })],
    files: { [`${dir}/a.ts`]: IMPORTS_ONLY, [`${dir}/b.ts`]: "export const b = 1;\n", [outside]: DEFINES, ...extra },
  });
  const moved = runGate(repo({}));
  assert.equal(moved.ok, true, moved.errors.join("\n"));
  assert.equal(moved.stats.reanchored, 1);
  const back = runGate(repo({ [`${dir}/b.ts`]: DEFINES }));
  assert.equal(back.ok, false);
  assert.match(back.errors.join("\n"), /台账条目已经自己好了/);
});

test("⑨ 旧锚下没有可扫描的源码（测试、夹具、类型声明、非代码文件）→ 没有定义可判，沿用文本命中", () => {
  const testFile = "electron/tasks/taskResultQuery.test.ts";
  const out = runGate(movedRepo({
    boundary: { path: testFile, symbol: SYMBOL },
    rows: [movedRow({ from: testFile })],
    files: { [testFile]: IMPORTS_ONLY, [NEW_FILE]: DEFINES },
  }));
  assert.equal(out.ok, false);
  assert.match(out.errors.join("\n"), /台账条目已经自己好了/);
});

// 两道门对「主人在不在」只有一个答案：同一批代码形状，边界门的 ownerDefinedAt 与概念门的 evaluateOwnership 必须同向。
// 哪一边改了「什么算定义」（比如不再把接口成员槽位算在位），这张表就红，逼着两边一起改。
const OWNER_SHAPES = [
  ["函数声明", "export function owner() {}\n", true],
  ["箭头函数常量", "export const owner = () => 1;\n", true],
  ["对象成员", "export const table = { owner: 1 };\n", true],
  ["类的方法", "export class Port { owner() {} }\n", true],
  ["类型别名", "export type owner = string;\n", true],
  ["接口里的成员槽位（契约，不是实现）", "export interface Port { owner?: () => void }\n", true],
  ["import 加调用", 'import { owner } from "./elsewhere";\nexport const run = () => owner();\n', false],
  ["别名", 'import * as ns from "./elsewhere";\nexport const owner = ns.owner;\n', false],
  ["重导出", 'export { owner } from "./elsewhere";\n', false],
  ["环境声明", "declare const owner: () => void;\n", false],
  ["只在注释和字符串里", '// owner 搬走了\nexport const note = "owner";\n', false],
];

test("⑩ 两道门对「主人在不在」只有一个答案：同一批代码形状，边界门的 ownerDefinedAt 与概念门的 evaluateOwnership 同向", () => {
  const fileOf = (index) => `electron/shape${index}.ts`;
  const root = sandbox(Object.fromEntries(OWNER_SHAPES.map(([, source], index) => [fileOf(index), source])));
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  OWNER_SHAPES.forEach(([name, , expected], index) => {
    const file = fileOf(index);
    const definitions = collectDefinitions({ files: [file], read, symbols: ["owner"] });
    const concept = { name: "c", write_api: [{ path: file, symbol: "owner" }], forbidden_derivations: [] };
    const { findings } = evaluateOwnership({ concepts: [concept], definitions, exists: () => true, read });
    assert.equal(!findings.some((item) => item.rule === "owner-unresolved"), expected, `${name}：概念门`);
    assert.equal(ownerDefinedAt(root, { path: file, symbol: "owner" }), expected, `${name}：边界门`);
  });
});

const CLI = fileURLToPath(new URL("./check-boundary-owners.mjs", import.meta.url));

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("⑪ 入口端到端：搬家且旧文件 import 着 → 退出 0 且计入改锚；旧文件定义回来 → 退出 1", () => {
  const green = runCli("--repo-root", movedPair(IMPORTS_ONLY));
  assert.equal(green.status, 0, green.output);
  assert.match(green.output, /改锚 1 ｜/);
  const red = runCli("--repo-root", movedPair(`${IMPORTS_ONLY}${DEFINES}`));
  assert.equal(red.status, 1, red.output);
  assert.match(red.output, /台账条目已经自己好了/);
});

test("入口只认 --repo-root：位置参数和别的开关不能被静默忽略（忽略的结果是悄悄检查脚本所在的这棵树，还报绿）", () => {
  const root = movedPair(IMPORTS_ONLY);
  for (const args of [[root], ["--update"], ["--repo-root", root, "extra"], [`--repo-root=${root}`]]) {
    const out = runCli(...args);
    assert.equal(out.status, 2, `${args.join(" ")}：${out.output}`);
    assert.match(out.output, /不认识的参数/);
  }
});
