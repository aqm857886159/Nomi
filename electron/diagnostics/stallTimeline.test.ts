// 卡顿时间线：隐私矩阵、限频与上限、坏数据、活过重启、无停顿 0 次写盘。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactLogValue } from "../logging/redact";
import { STALL_ROW_FIELDS, STALL_ROW_KINDS, parseStallRow, type StallRow, type StallRowKind } from "../shared/contracts/stallTimeline";
import {
  STALL_KIND_MIN_GAP_MS,
  STALL_TIMELINE_FILE,
  STALL_TIMELINE_MAX_BYTES,
  createStallTimeline,
  createStallTimelineAppend,
  readStallTimeline,
  stallRowsToJsonl,
} from "./stallTimeline";

const T = "2026-10-31T10:00:00.000Z";
const SCENE = { page: "generation", nodes: "21-100", generating: true } as const;
const SAMPLES: Record<StallRowKind, StallRow> = {
  "main-stall": { t: T, kind: "main-stall", ms: 1203, frozen: true, ...SCENE },
  "window-unresponsive": { t: T, kind: "window-unresponsive", ...SCENE },
  "window-responsive": { t: T, kind: "window-responsive", ms: 5200, ...SCENE },
  "renderer-long-frame": { t: T, kind: "renderer-long-frame", ms: 340, ...SCENE },
  "stall-summary": { t: T, kind: "stall-summary", ms: 1500, count: 12 },
};

let dir = "";
let clock = 0;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-stall-timeline-"));
  clock = Date.parse(T);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function realTimeline() {
  return createStallTimeline({ append: createStallTimelineAppend(() => dir), now: () => clock });
}
const fileText = (name = STALL_TIMELINE_FILE): string => fs.readFileSync(path.join(dir, name), "utf8");
const jsonLines = (text: string): Record<string, unknown>[] =>
  text.split("\n").map((line) => line.replace(/^\[[^\]]*\]\s?/, "")).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as Record<string, unknown>);

describe("隐私矩阵：每种行的字段集合等于白名单", () => {
  it.each(STALL_ROW_KINDS)("%s：样本合格、键落在白名单内、必有的都在", (kind) => {
    const sample = SAMPLES[kind];
    expect(parseStallRow(sample)).not.toBeNull();
    const spec = STALL_ROW_FIELDS[kind];
    const allowed = new Set<string>([...spec.required, ...spec.optional]);
    expect(Object.keys(sample).every((key) => allowed.has(key))).toBe(true);
    expect(spec.required.every((key) => key in sample)).toBe(true);
  });

  it.each(STALL_ROW_KINDS.filter((kind) => kind !== "stall-summary"))("%s：真写进盘再读回，每一行的键仍在白名单内，且整行过敏感信息扫描一个字不改", (kind) => {
    const timeline = realTimeline();
    expect(timeline.record(SAMPLES[kind])).toBe(true);
    const text = fileText();
    const rows = jsonLines(text);
    expect(rows).toHaveLength(1);
    const spec = STALL_ROW_FIELDS[kind];
    const allowed = new Set<string>([...spec.required, ...spec.optional]);
    for (const row of rows) {
      expect(Object.keys(row).every((key) => allowed.has(key))).toBe(true);
      expect(spec.required.every((key) => key in row)).toBe(true);
    }
    for (const line of text.split("\n").filter(Boolean)) {
      const body = line.replace(/^\[[^\]]*\]\s?/, "");
      expect(redactLogValue(body)).toBe(body);
    }
  });

  it("汇总行（风暴时才有）同样只有白名单键", () => {
    const timeline = realTimeline();
    for (let i = 0; i < 8; i += 1) { clock += 5_000; timeline.record(SAMPLES["main-stall"]); }
    clock += 60_000;
    timeline.tick();
    const summary = jsonLines(fileText()).find((row) => row.kind === "stall-summary");
    expect(summary).toBeDefined();
    expect(Object.keys(summary!).sort()).toEqual(["count", "kind", "ms", "t"]);
    expect(parseStallRow(summary)).not.toBeNull();
  });

  it.each(STALL_ROW_KINDS)("%s：往行里塞路径 / 提示词 / 多余键，写入层整行拒收，盘上一个字都没有", (kind) => {
    const timeline = realTimeline();
    const poisons: Record<string, unknown>[] = [
      { ...SAMPLES[kind], path: "/Users/someone/Nomi Projects/猫咪短片/a.png" },
      { ...SAMPLES[kind], prompt: "a cat on the roof" },
      { ...SAMPLES[kind], projectName: "我的片子" },
      { ...SAMPLES[kind], t: "/Users/someone/secret" },
      { ...SAMPLES[kind], page: "/Users/someone/secret" },
      { ...SAMPLES[kind], nodes: "C:\\Users\\someone\\secret" },
    ];
    for (const poison of poisons) {
      expect(parseStallRow(poison)).toBeNull();
      expect(timeline.record(poison)).toBe(false);
    }
    expect(fs.existsSync(path.join(dir, STALL_TIMELINE_FILE))).toBe(false);
    expect(timeline.stats()).toMatchObject({ written: 0, rejected: poisons.length });
  });

  it("数值也有界：负数、小数、超大、NaN、字符串数字都不合格", () => {
    for (const ms of [-1, 1.5, 86_400_001, Number.NaN, "1200"]) expect(parseStallRow({ ...SAMPLES["main-stall"], ms })).toBeNull();
    expect(parseStallRow({ ...SAMPLES["main-stall"], frozen: "yes" })).toBeNull();
    expect(parseStallRow({ ...SAMPLES["stall-summary"], count: -3 })).toBeNull();
  });
});

describe("限频与上限", () => {
  it("同一种行每 10 秒最多一行，不同种类互不挤占", () => {
    const timeline = realTimeline();
    expect(timeline.record(SAMPLES["main-stall"])).toBe(true);
    clock += 5_000;
    expect(timeline.record(SAMPLES["main-stall"])).toBe(false);
    expect(timeline.record(SAMPLES["window-unresponsive"])).toBe(true);
    clock += STALL_KIND_MIN_GAP_MS - 5_000;
    expect(timeline.record(SAMPLES["main-stall"])).toBe(true);
    expect(jsonLines(fileText()).map((row) => row.kind)).toEqual(["main-stall", "window-unresponsive", "main-stall"]);
  });

  it("零星的停顿不写汇总；风暴那一分钟写一行汇总（行数 = 写下的 + 被略掉的）", () => {
    const timeline = realTimeline();
    timeline.record(SAMPLES["main-stall"]);
    clock += 61_000;
    timeline.tick();
    expect(jsonLines(fileText()).some((row) => row.kind === "stall-summary")).toBe(false);
    for (let i = 0; i < 10; i += 1) { clock += 4_000; timeline.record({ ...SAMPLES["main-stall"], ms: 1000 + i }); }
    clock += 30_000;
    timeline.tick();
    const summaries = jsonLines(fileText()).filter((row) => row.kind === "stall-summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ count: 10, ms: 1009 });
  });

  it("模拟风暴：每秒一次 ≥1 秒停顿跑 1 小时——每分钟行数符合限频，总量不超上限", () => {
    const timeline = realTimeline();
    const perMinute = new Map<number, number>();
    const start = clock;
    for (let second = 0; second < 3600; second += 1) {
      clock = start + second * 1000;
      const before = timeline.stats().written;
      timeline.record({ ...SAMPLES["main-stall"], ms: 1200 + (second % 50) });
      timeline.tick();
      const wrote = timeline.stats().written - before;
      perMinute.set(Math.floor(second / 60), (perMinute.get(Math.floor(second / 60)) ?? 0) + wrote);
    }
    // 每分钟：main-stall 最多 6 行（每 10 秒一行）+ 1 行汇总。
    expect(Math.max(...perMinute.values())).toBeLessThanOrEqual(7);
    expect(timeline.stats().written).toBeGreaterThan(300); // 防空断言：风暴确实在写
    expect(timeline.stats().written).toBeLessThanOrEqual(3600 / 10 + 3600 / 60 + 2);
    const bytes = fs.statSync(path.join(dir, STALL_TIMELINE_FILE)).size;
    expect(bytes).toBeLessThanOrEqual(STALL_TIMELINE_MAX_BYTES);
  });

  it("连续风暴 24 小时：当前文件 + 旧一代的总量不超过两倍上限，且读回的都是合格行", () => {
    const timeline = realTimeline();
    const start = clock;
    for (let second = 0; second < 24 * 3600; second += 3) {
      clock = start + second * 1000;
      timeline.record({ ...SAMPLES["main-stall"], ms: 1200 });
      timeline.tick();
    }
    const names = fs.readdirSync(dir).sort();
    expect(names).toEqual(["nomi-stall-timeline.1.log", "nomi-stall-timeline.log"]); // 防空断言：真的滚动过
    const total = names.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
    expect(total).toBeLessThanOrEqual(2 * STALL_TIMELINE_MAX_BYTES + 512);
    const read = readStallTimeline(dir);
    expect(read.rows.length).toBeGreaterThan(1000);
    expect(read.droppedLines).toBe(0);
  });
});

describe("无停顿时 0 次写盘", () => {
  it("一小时的安静读数：写盘 0 次；窗内有停顿时恰好写一次（防空断言）", () => {
    const append = vi.fn();
    const timeline = createStallTimeline({ append, now: () => clock });
    for (let i = 0; i < 360; i += 1) { clock += 10_000; timeline.tick(); }
    expect(append).toHaveBeenCalledTimes(0);
    expect(timeline.stats().written).toBe(0);
    timeline.record(SAMPLES["main-stall"]);
    expect(append).toHaveBeenCalledTimes(1);
    expect(timeline.stats().written).toBe(1);
  });
});

describe("读回：坏数据不崩、照实计数；活过重启", () => {
  it("好行 + 半行 + 乱码 + 多余键 + 表头 + 空行：只留好行，坏的计入 droppedLines", () => {
    const good = JSON.stringify(SAMPLES["main-stall"]);
    fs.writeFileSync(
      path.join(dir, STALL_TIMELINE_FILE),
      [
        `[${T}] --- session nomi=0.24.0 electron=43.4.1 darwin-arm64 pid=1`,
        `[${T}] ${good}`,
        `[${T}] {"t":"2026-10-31T10:0`,
        "\u0000\u0001garbage",
        `[${T}] ${JSON.stringify({ ...SAMPLES["main-stall"], path: "/Users/x/a.png" })}`,
        "",
      ].join("\n"),
    );
    const read = readStallTimeline(dir);
    expect(read.rows).toEqual([SAMPLES["main-stall"]]);
    expect(read.droppedLines).toBe(3);
    expect(read.file).toBe("present");
  });

  it("空文件：存在、0 行、不丢弃任何行；没有文件（新装 / 旧版升级）：absent；读不了：unreadable", () => {
    fs.writeFileSync(path.join(dir, STALL_TIMELINE_FILE), "");
    expect(readStallTimeline(dir)).toEqual({ rows: [], droppedLines: 0, file: "present" });
    fs.rmSync(path.join(dir, STALL_TIMELINE_FILE));
    expect(readStallTimeline(dir)).toEqual({ rows: [], droppedLines: 0, file: "absent" });
    expect(readStallTimeline(path.join(dir, "no-such-dir"))).toEqual({ rows: [], droppedLines: 0, file: "absent" });
    fs.mkdirSync(path.join(dir, STALL_TIMELINE_FILE));
    expect(readStallTimeline(dir).file).toBe("unreadable");
  });

  it("记录后「重启」（新实例、新写手）：上一次的行还在，本次启动写盘数是 0", () => {
    const first = realTimeline();
    first.record(SAMPLES["main-stall"]);
    first.record(SAMPLES["window-unresponsive"]);
    const second = realTimeline();
    expect(second.stats().written).toBe(0);
    clock += 60_000;
    second.record(SAMPLES["renderer-long-frame"]);
    const read = readStallTimeline(dir);
    expect(read.rows.map((row) => row.kind)).toEqual(["main-stall", "window-unresponsive", "renderer-long-frame"]);
    expect(stallRowsToJsonl(read.rows).split("\n").filter(Boolean)).toHaveLength(3);
  });
});
