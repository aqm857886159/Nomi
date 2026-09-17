import { describe, expect, it } from "vitest";
import {
  CHUNK_SECONDS,
  MIN_ADVANCE_SECONDS,
  TAIL_SECONDS,
  WINDOW_SECONDS,
  acceptChunkSegments,
  countChunks,
  joinSegmentText,
  planNextChunk,
} from "./localSpeechSegments";

describe("本地转写分段", () => {
  it("段长是 whisper 30 秒窗口的整数倍", () => {
    expect(CHUNK_SECONDS % WINDOW_SECONDS).toBe(0);
    expect(TAIL_SECONDS % WINDOW_SECONDS).toBe(0);
  });

  it("短音频只有一段，且是最后一段（不多喂尾巴）", () => {
    const plan = planNextChunk(0, 42);
    expect(plan).toMatchObject({ index: 0, startSeconds: 0, lengthSeconds: 42, nominalEndSeconds: 42, isLast: true });
  });

  it("长音频的中间段多喂一个窗口当上下文，但名义段仍是 CHUNK_SECONDS", () => {
    const plan = planNextChunk(0, 4000);
    expect(plan?.isLast).toBe(false);
    expect(plan?.nominalEndSeconds).toBe(CHUNK_SECONDS);
    expect(plan?.lengthSeconds).toBe(CHUNK_SECONDS + TAIL_SECONDS);
  });

  it("转完就没有下一段了", () => {
    expect(planNextChunk(120, 120)).toBeNull();
    expect(planNextChunk(0, 0)).toBeNull();
  });

  it("段数 = 时长按段长向上取整", () => {
    expect(countChunks(0)).toBe(0);
    expect(countChunks(1)).toBe(1);
    expect(countChunks(CHUNK_SECONDS)).toBe(1);
    expect(countChunks(CHUNK_SECONDS + 1)).toBe(2);
  });

  it("段内相对时间被折进全局时间轴", () => {
    const plan = planNextChunk(CHUNK_SECONDS, 4000)!;
    const { kept } = acceptChunkSegments(plan, [{ start: 1, end: 2.5, text: "你好" }]);
    expect(kept).toEqual([{ start: CHUNK_SECONDS + 1, end: CHUNK_SECONDS + 2.5, text: "你好" }]);
  });

  it("中间段只采纳名义段内开始的句子，尾巴里新起的句子留给下一段", () => {
    const plan = planNextChunk(0, 4000)!;
    const { kept } = acceptChunkSegments(plan, [
      { start: 10, end: 12, text: "段内" },
      { start: CHUNK_SECONDS + 5, end: CHUNK_SECONDS + 7, text: "尾巴里新起的一句" },
    ]);
    expect(kept.map((segment) => segment.text)).toEqual(["段内"]);
  });

  it("横跨边界那一句被完整采纳，游标推到它的结尾——下一段从下一句开头起跑，不重不断", () => {
    const plan = planNextChunk(0, 4000)!;
    const { kept, nextCursorSeconds } = acceptChunkSegments(plan, [
      { start: CHUNK_SECONDS - 2, end: CHUNK_SECONDS + 4, text: "横跨边界的一句" },
    ]);
    expect(kept).toHaveLength(1);
    expect(nextCursorSeconds).toBe(CHUNK_SECONDS + 4);
  });

  it("句子在名义段内就结束时游标推到名义段尾，不退回句尾（否则一段静音就能把循环拖死）", () => {
    const plan = planNextChunk(0, 4000)!;
    const { nextCursorSeconds } = acceptChunkSegments(plan, [{ start: 1, end: 9, text: "开头说了一句，后面全是静音" }]);
    expect(nextCursorSeconds).toBe(CHUNK_SECONDS);
  });

  it("整段没有任何句子（纯静音）也必须前进", () => {
    const plan = planNextChunk(0, 4000)!;
    const { kept, nextCursorSeconds } = acceptChunkSegments(plan, []);
    expect(kept).toEqual([]);
    expect(nextCursorSeconds).toBeGreaterThanOrEqual(plan.startSeconds + MIN_ADVANCE_SECONDS);
    expect(nextCursorSeconds).toBe(CHUNK_SECONDS);
  });

  it("最后一段把尾巴里的句子也收下，否则结尾会缺一截", () => {
    const plan = planNextChunk(0, 100)!;
    const { kept, nextCursorSeconds } = acceptChunkSegments(plan, [
      { start: 1, end: 2, text: "前" },
      { start: 98, end: 100, text: "最后一句" },
    ]);
    expect(kept.map((segment) => segment.text)).toEqual(["前", "最后一句"]);
    expect(nextCursorSeconds).toBeGreaterThanOrEqual(100);
  });

  it("空文本与非有限时间的段被丢掉（引擎偶尔回这种），不进结果", () => {
    const plan = planNextChunk(0, 100)!;
    const { kept } = acceptChunkSegments(plan, [
      { start: 1, end: 2, text: "  " },
      { start: Number.NaN, end: 3, text: "坏时间" },
      { start: 4, end: 5, text: " 有效 " },
    ]);
    expect(kept).toEqual([{ start: 4, end: 5, text: "有效" }]);
  });

  it("整条音频能在有限步内跑完（游标严格前进，不会死循环）", () => {
    const duration = 3 * CHUNK_SECONDS + 7;
    let cursor = 0;
    let steps = 0;
    for (;;) {
      const plan = planNextChunk(cursor, duration);
      if (!plan) break;
      steps += 1;
      expect(steps).toBeLessThanOrEqual(10);
      const next = acceptChunkSegments(plan, []).nextCursorSeconds;
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(steps).toBe(countChunks(duration));
  });

  it("拼出来的整篇与云端 verbose_json 的 text 同形状（句间换行）", () => {
    expect(joinSegmentText([{ start: 0, end: 1, text: "一" }, { start: 1, end: 2, text: "二" }])).toBe("一\n二");
  });
});
