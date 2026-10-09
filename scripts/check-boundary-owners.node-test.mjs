import { makeTempDir } from './_test-temp.mjs'
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { VERDICT, checkBoundary, evaluate, hasWord, readContracts, resolveSymbol } from "./boundary-owners.mjs";

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
