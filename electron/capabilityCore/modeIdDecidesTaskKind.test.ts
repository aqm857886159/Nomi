// 模型明说了模式，就别再去猜种类——`taskKind` 与 `modeId` 是同一件事实的两种写法。
//
// run2 的 A3/A6 三次：模型写了 `modeId: "i2v"` / `"t2v"` 而**没写** taskKind，我们按提示词猜了一个，
// 再拿自己猜的那个去和它明说的模式比对，然后把冲突算在它头上——错误正文写着
// 「this shot asks for text_to_video」，而模型一个字都没这么说。
import { describe, expect, it } from "vitest";

import { shotTaskKind } from "./semanticGenerationCandidate";

const kindOf = (params: Record<string, unknown>) => shotTaskKind({ params });
import { transportTaskKindForModeId } from "../shared/videoCapabilities";

describe("modeId 定了，taskKind 就定了", () => {
  it("i2v / t2v / firstlast 各自决定种类（从档案扫出来，不是手抄的表）", () => {
    expect(transportTaskKindForModeId("i2v")).toBe("image_to_video");
    expect(transportTaskKindForModeId("t2v")).toBe("text_to_video");
    expect(transportTaskKindForModeId("firstlast")).toBe("image_to_video");
  });

  it("`omni` **确实**说不准，所以不许编一个——一张手抄的表在这里会答错", () => {
    // `seedance-2.5-runway` 的 omni 声明的是 `text_to_video`，而别家的 omni 是 `image_to_video`。
    // 扫出来的答案是「说不准」；手抄一张表的人多半会写 image_to_video，然后在 Runway 那一路上答错。
    expect(transportTaskKindForModeId("omni")).toBeUndefined();
  });

  it("认不出的 id 不编答案（上游换了种类也会落到这里）", () => {
    expect(transportTaskKindForModeId("no-such-mode")).toBeUndefined();
    expect(transportTaskKindForModeId("  ")).toBeUndefined();
  });

  it("A3：写了 i2v 没写 taskKind → 推出 image_to_video，而不是按提示词猜 text_to_video", () => {
    expect(kindOf({ modeId: "i2v", prompt: "深夜街道，一位夜归人走近摊位，镜头缓慢拉远" }))
      .toBe("image_to_video");
  });

  it("A6：写了 t2v 没写 taskKind → 推出 text_to_video，而不是 text_to_image", () => {
    expect(kindOf({ modeId: "t2v", prompt: "招牌灯还亮着" })).toBe("text_to_video");
  });

  it("模型自己写了 taskKind 就听它的——派生只补它没说的那一格", () => {
    expect(kindOf({ modeId: "i2v", taskKind: "text_to_video", prompt: "x" })).toBe("text_to_video");
  });

  // 2026-09-30（付费卡① 第 9 条）：提示词启发式整个删了——没写模式、没写种类、也没点名模型，就请它写明，
  // 不再按「视频 / 镜头」这类词替它定（那正是「做一个封面」被建成视频镜头的那条路）。
  it("没有 modeId、没有 taskKind、也没点名模型 → 拒绝并请它写明，不按提示词猜", () => {
    expect(() => kindOf({ prompt: "一只猫" })).toThrow(/set taskKind/);
    expect(() => kindOf({ prompt: "一段视频，镜头推近" })).toThrow(/set taskKind/);
  });
});

// run3 里那句「Video mode omni is a undefined mode」：帮忙的话不许把 undefined 递给模型。
describe("拒绝信里不许出现 undefined", () => {
  it("源码里每一处插值 transportTaskKind 的拒绝信都先判过它在不在", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("electron/capabilityCore/mcpGenerationVideoResolve.ts", "utf8");
    // 拒收现在由闭合原因生成正文（`refuseGeneration`），事实常写在下一行的 `allowed:` / `detail:` 里，所以整份文件扫插值。
    const refusals = source.split("\n").filter((line) => line.includes("transportTaskKind") && line.includes("${"));
    expect(refusals.length, "扫描器至少认得出那一处带守卫的插值").toBeGreaterThan(0);
    // 直接把 `${mode.transportTaskKind}` 插进句子里的写法一条都不许剩（要么走 `kind` 守卫，要么走三元）。
    expect(refusals.filter((line) => /\$\{mode\.transportTaskKind\}/.test(line))).toEqual([]);
    expect(refusals.filter((line) => /\$\{item\.transportTaskKind\}/.test(line) && !line.includes("item.transportTaskKind ?"))).toEqual([]);
  });
});
