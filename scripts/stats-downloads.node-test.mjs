// 下载量快照的**落点解析**单测。
//
// 守的不变量：快照文件的位置永远由调用者显式给出，脚本自己不会在源码树里挑一个地方写。
// 2026-09-02→09-06 那 20 天连红的根因就是「派生数据默认写进源码树」——路径 hardcode 在
// docs/stats/downloads-history.json，于是机器人只能去推受保护的 main，天天被 GH006 拒。
// 路径可注入之后，这个类才真正没了；下面的用例就是那条边界的守卫。
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  DEFAULT_DATA_REF,
  HISTORY_FILENAME,
  loadHistory,
  resolveHistoryPath,
  resolveHistoryRef,
  writeSnapshot,
} from "./stats-downloads.mjs";

const agg = { total: 7, byPlatform: { windows: 4, macArm: 2, macIntel: 1 }, byVersion: { "v1.0.0": { dl: 7, published: "2026-09-01" } } };

test("没有显式落点时解析结果是 null（写路径据此 fail-closed）", () => {
  assert.equal(resolveHistoryPath({ env: {}, cwd: "/repo" }), null);
  assert.equal(resolveHistoryPath({ env: { NOMI_STATS_HISTORY_PATH: "   " }, cwd: "/repo" }), null);
});

test("相对落点按调用者的 cwd 解析，不按脚本所在的 checkout", () => {
  // CI 里脚本住源码 checkout，数据分支 checkout 在 workspace 的另一个子目录。
  assert.equal(
    resolveHistoryPath({ env: { NOMI_STATS_HISTORY_PATH: ".stats-data/downloads-history.json" }, cwd: "/work/nomi" }),
    path.resolve("/work/nomi", ".stats-data/downloads-history.json"),
  );
});

test("绝对落点原样采用", () => {
  const abs = path.resolve("/work/nomi/.stats-data", HISTORY_FILENAME);
  assert.equal(resolveHistoryPath({ env: { NOMI_STATS_HISTORY_PATH: abs }, cwd: "/elsewhere" }), abs);
});

test("本地只读默认走数据分支 ref，可被环境变量覆盖", () => {
  assert.equal(resolveHistoryRef({ env: {} }), DEFAULT_DATA_REF);
  assert.equal(resolveHistoryRef({ env: { NOMI_STATS_DATA_REF: "origin/stats-data-fork" } }), "origin/stats-data-fork");
});

test("给了落点就读那个文件，读不到时标 missing 而不是假装有历史", () => {
  const file = path.resolve("/work/nomi/.stats-data", HISTORY_FILENAME);
  const present = loadHistory({
    env: { NOMI_STATS_HISTORY_PATH: file },
    cwd: "/work/nomi",
    readFileAt: (target) => (target === file ? JSON.stringify({ snapshots: [{ date: "2026-09-01", total: 3 }] }) : null),
  });
  assert.equal(present.missing, false);
  assert.equal(present.source, file);
  assert.equal(present.history.snapshots.length, 1);

  const absent = loadHistory({ env: { NOMI_STATS_HISTORY_PATH: file }, cwd: "/work/nomi", readFileAt: () => null });
  assert.equal(absent.missing, true);
  assert.deepEqual(absent.history, { snapshots: [] });
});

test("没给落点就从数据分支 ref 读，来源写清楚给人看", () => {
  const asked = [];
  const loaded = loadHistory({
    env: {},
    cwd: "/work/nomi",
    readFromRef: (ref) => {
      asked.push(ref);
      return JSON.stringify({ snapshots: [{ date: "2026-08-16", total: 9 }] });
    },
  });
  assert.deepEqual(asked, [DEFAULT_DATA_REF]);
  assert.equal(loaded.source, `${DEFAULT_DATA_REF}:${HISTORY_FILENAME}`);
  assert.equal(loaded.history.snapshots[0].total, 9);
});

test("没有显式落点时 writeSnapshot 拒绝写，而不是回落到源码树", () => {
  assert.throws(
    () => writeSnapshot(agg, { env: {}, cwd: "/work/nomi", writeFileAt: () => assert.fail("不该写任何文件") }),
    /NOMI_STATS_HISTORY_PATH/,
  );
});

test("写快照落在显式落点上，同日幂等覆盖并算出与上一不同日的差值", () => {
  const file = path.resolve("/work/nomi/.stats-data", HISTORY_FILENAME);
  const writes = [];
  const result = writeSnapshot(agg, {
    env: { NOMI_STATS_HISTORY_PATH: file },
    cwd: "/work/nomi",
    writeFileAt: (target, content) => writes.push({ target, content }),
    loadHistoryImpl: () => ({
      history: { snapshots: [{ date: "2026-08-16", total: 5 }, { date: new Date().toISOString().slice(0, 10), total: 6 }] },
      source: file,
      missing: false,
    }),
  });

  assert.equal(result.file, file);
  assert.equal(result.sinceLast, 2); // 7 - 5，跟同日那份无关
  assert.equal(writes.length, 1);
  assert.equal(writes[0].target, file);
  const written = JSON.parse(writes[0].content);
  assert.equal(written.snapshots.length, 2); // 同日只留最新一份
  assert.equal(written.snapshots.at(-1).total, 7);
});
