import { describe, expect, it } from "vitest";
import {
  assignSegmentsToShots,
  buildShotBoundaries,
  minShotSeconds,
  sampleSecondsForShot,
  type TranscriptSegment,
} from "./shotTimeline";

// 夹具沿用 tests/ux/shot-cuts.walk.mjs 那段真实视频的形状：8 秒、3 个硬切（2/4/6）→ **4 段镜头**。
const CUTS = [2, 4, 6];
const DURATION = 8;
const shots = () => buildShotBoundaries(CUTS, DURATION);

describe("buildShotBoundaries：切点 → 镜头区间", () => {
  it("N 个切点切出 N+1 段（第一段从 0 开始，别丢开场镜）", () => {
    expect(shots()).toEqual([
      { index: 1, startSeconds: 0, endSeconds: 2 },
      { index: 2, startSeconds: 2, endSeconds: 4 },
      { index: 3, startSeconds: 4, endSeconds: 6 },
      { index: 4, startSeconds: 6, endSeconds: 8 },
    ]);
  });

  it("一镜到底（零切点）→ 整条就是一镜，不是零镜", () => {
    expect(buildShotBoundaries([], 12)).toEqual([{ index: 1, startSeconds: 0, endSeconds: 12 }]);
  });

  it("切点乱序/重复/超界 → 归一化，不产出 0 长或倒序镜头", () => {
    const out = buildShotBoundaries([6, 2, 2, 4, 99, -3], 8);
    expect(out.map((s) => [s.startSeconds, s.endSeconds])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8]]);
  });

  it("贴片头/片尾的切点丢掉（否则切出 0 长镜头）", () => {
    // 「多贴算贴」不是拍脑袋的常数，是源片说了算：30fps 取 3 帧 → 0.079s 以内都取不出三张不同的帧。
    // 0.005 和 7.999 落在这个区间里，所以被丢（下面「碎镜按帧率过滤」那组把这条判据本身钉死）。
    expect(buildShotBoundaries([0, 0.005, 7.999, 8], 8, { fps: 30, framesPerShot: 3 }))
      .toEqual([{ index: 1, startSeconds: 0, endSeconds: 8 }]);
  });

  it("完全退化的切点（0 / 片尾 / 越界 / NaN）即便拿不到 fps 也要丢掉", () => {
    expect(buildShotBoundaries([0, 8, 99, Number.NaN], 8)).toEqual([{ index: 1, startSeconds: 0, endSeconds: 8 }]);
  });

  it("时长缺失/为 0 → 空数组，不抛", () => {
    expect(buildShotBoundaries([2, 4], 0)).toEqual([]);
    expect(buildShotBoundaries([2, 4], Number.NaN)).toEqual([]);
  });
});

describe("assignSegmentsToShots：句子归属", () => {
  const seg = (start: number, end: number, text: string): TranscriptSegment => ({ start, end, text });

  it("普通情况：每句落在自己那一镜", () => {
    const out = assignSegmentsToShots([seg(0.5, 1.5, "第一镜的话"), seg(4.2, 5.5, "第三镜的话")], shots());
    expect(out.map((r) => r.text)).toEqual(["第一镜的话", "", "第三镜的话", ""]);
  });

  it("跨镜长句不切分：整句归**起始镜**，被跨的镜标承接上镜", () => {
    const out = assignSegmentsToShots([seg(1.5, 3.2, "这句话从第一镜说到第二镜")], shots());
    expect(out[0].text).toBe("这句话从第一镜说到第二镜");
    expect(out[1].text).toBe("");
    expect(out[1].carriedOver).toBe(true);
    expect(out[0].carriedOver).toBe(false);
  });

  it("跨多镜的超长句：中间每一镜都标承接上镜（不能只标最后一镜）", () => {
    const out = assignSegmentsToShots([seg(1.0, 6.5, "一句话横跨四镜")], shots());
    expect(out[0].text).toBe("一句话横跨四镜");
    expect(out.map((r) => r.carriedOver)).toEqual([false, true, true, true]);
  });

  it("边界句：起始时间正好落在切点上 → 归**后**一镜（切点是新镜的开始）", () => {
    const out = assignSegmentsToShots([seg(2, 3, "正好卡在切点")], shots());
    expect(out[0].text).toBe("");
    expect(out[1].text).toBe("正好卡在切点");
  });

  it("静音镜：没句子的镜头留空，且不误标承接", () => {
    const out = assignSegmentsToShots([seg(0.2, 1.0, "只有第一镜有声")], shots());
    expect(out.slice(1).every((r) => r.text === "" && r.carriedOver === false)).toBe(true);
  });

  it("同一镜多句 → 合并成一段，保持时间顺序", () => {
    const out = assignSegmentsToShots([seg(1.2, 1.6, "后半句"), seg(0.2, 0.8, "前半句")], shots());
    expect(out[0].text).toBe("前半句 后半句");
  });

  it("超出片尾的句子归最后一镜，不丢（whisper 偶尔给出略超时长的时间戳）", () => {
    const out = assignSegmentsToShots([seg(8.4, 9.9, "尾巴上的话")], shots());
    expect(out[3].text).toBe("尾巴上的话");
  });

  it("空转写 / 空白句 → 全空，不抛也不produce 垃圾", () => {
    expect(assignSegmentsToShots([], shots()).every((r) => r.text === "")).toBe(true);
    expect(assignSegmentsToShots([seg(1, 2, "   ")], shots()).every((r) => r.text === "")).toBe(true);
  });

  it("没有镜头（拆解失败）→ 返回空数组而不是崩", () => {
    expect(assignSegmentsToShots([seg(1, 2, "x")], [])).toEqual([]);
  });
});

describe("sampleSecondsForShot：一镜抽哪几帧", () => {
  it("默认 3 帧，首/中/尾，两端各内缩 8% 躲开转场", () => {
    const out = sampleSecondsForShot({ index: 1, startSeconds: 0, endSeconds: 10 });
    expect(out).toEqual([0.8, 5, 9.2]);
  });

  it("采样点严格落在镜头区间内（绝不越界到隔壁镜）", () => {
    const shot = { index: 2, startSeconds: 2, endSeconds: 4 };
    for (const s of sampleSecondsForShot(shot)) {
      expect(s).toBeGreaterThan(shot.startSeconds);
      expect(s).toBeLessThan(shot.endSeconds);
    }
  });

  it("极短镜（0.3 秒）也能出 3 个不同的点，不塌成同一帧", () => {
    const out = sampleSecondsForShot({ index: 1, startSeconds: 1, endSeconds: 1.3 });
    expect(new Set(out).size).toBe(3);
  });

  it("frames=1 时取中点（省钱档）", () => {
    expect(sampleSecondsForShot({ index: 1, startSeconds: 0, endSeconds: 10 }, 1)).toEqual([5]);
  });

  it("0 长镜头不产生 NaN", () => {
    expect(sampleSecondsForShot({ index: 1, startSeconds: 3, endSeconds: 3 })).toEqual([3]);
  });
});

// 2026-09-11 用户看到的那条 `0.0333333s` 镜头：30fps 的第 2 帧（pts 0.0333）被 ffmpeg 的
// `select(scene>0.1)` 当成切点，而老代码的判据是写死的 `s > 0.01` —— `0.0333 > 0.01`，放行。
// 修法不是把 0.01 调大（那只是换一个也会错的常数），是**从源片的帧率派生**。
describe("minShotSeconds：最短镜头必须随帧率变，写死的常数不可能同时对两种帧率", () => {
  it("30fps 取 3 帧 → 约 0.079s（三帧落在三个不同的源帧上所需的最短跨度）", () => {
    expect(minShotSeconds({ fps: 30, framesPerShot: 3 })).toBeCloseTo(2 / 30 / 0.84, 6);
  });

  it("12fps 取 3 帧 → 约 0.198s，是 30fps 那档的 2.5 倍", () => {
    const at12 = minShotSeconds({ fps: 12, framesPerShot: 3 });
    const at30 = minShotSeconds({ fps: 30, framesPerShot: 3 });
    expect(at12).toBeCloseTo(2 / 12 / 0.84, 6);
    expect(at12 / at30).toBeCloseTo(2.5, 6);
  });

  it("每镜只取 1 帧 → 退回一个帧间隔（没有「三帧要分开」这个约束了）", () => {
    expect(minShotSeconds({ fps: 25, framesPerShot: 1 })).toBeCloseTo(1 / 25, 6);
  });

  it("拿不到 fps → 返回 0：判不出来就不假装判得出（只有退化切点会被丢）", () => {
    expect(minShotSeconds({})).toBe(0);
    expect(minShotSeconds({ fps: 0, framesPerShot: 3 })).toBe(0);
  });
});

describe("buildShotBoundaries：碎镜按帧率过滤（写死常数的版本会在其中一档翻车）", () => {
  const CUT_AT_SECOND_FRAME_30FPS = 1 / 30; // 0.0333…，正是用户那条

  it("30fps：紧贴首帧的切点被丢掉，不再切出 0.03s 的一镜", () => {
    const out = buildShotBoundaries([CUT_AT_SECOND_FRAME_30FPS, 2.5], 5, { fps: 30, framesPerShot: 3 });
    expect(out.map((s) => [s.startSeconds, s.endSeconds])).toEqual([[0, 2.5], [2.5, 5]]);
  });

  it("12fps：0.12s 处的切点也要被丢——它在 30fps 下合法，在 12fps 下取不出三张不同的帧", () => {
    const cut = 0.12; // > 30fps 那档的 0.079，< 12fps 那档的 0.198
    expect(buildShotBoundaries([cut, 2.5], 5, { fps: 30, framesPerShot: 3 })
      .map((s) => s.startSeconds)).toEqual([0, cut, 2.5]);
    expect(buildShotBoundaries([cut, 2.5], 5, { fps: 12, framesPerShot: 3 })
      .map((s) => s.startSeconds)).toEqual([0, 2.5]);
  });

  it("贴着片尾的切点同样被丢（对称，不切出片尾碎镜）", () => {
    expect(buildShotBoundaries([5 - CUT_AT_SECOND_FRAME_30FPS], 5, { fps: 30, framesPerShot: 3 }))
      .toEqual([{ index: 1, startSeconds: 0, endSeconds: 5 }]);
  });

  it("连着两个近切点只留第一个（相邻也要拉开最短镜头长度）", () => {
    const out = buildShotBoundaries([2.0, 2.02, 3.5], 6, { fps: 30, framesPerShot: 3 });
    expect(out.map((s) => s.startSeconds)).toEqual([0, 2.0, 3.5]);
  });
});
