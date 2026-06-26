import { describe, it, expect } from "vitest";
import { buildMultiframeArgs, splitTransitionLines } from "./dreaminaCodec";

describe("splitTransitionLines", () => {
  it("按行拆 + 去空去首尾空格", () => {
    expect(splitTransitionLines("A→B\n  B→C  \n\nC→D")).toEqual(["A→B", "B→C", "C→D"]);
    expect(splitTransitionLines("")).toEqual([]);
  });
});

describe("buildMultiframeArgs（按图数变形）", () => {
  it("2 图：shorthand --prompt + --duration，不发 transition", () => {
    const args = buildMultiframeArgs({ imagePaths: ["/a.png", "/b.png"], prompt: "角色转身", transitionLines: ["角色转身"], duration: 4 });
    expect(args).toEqual(["multiframe2video", "--images=/a.png,/b.png", "--prompt=角色转身", "--duration=4", "--poll=30"]);
  });

  it("3 图：N-1=2 句 --transition-prompt，不发 --prompt/--duration", () => {
    const args = buildMultiframeArgs({ imagePaths: ["/a.png", "/b.png", "/c.png"], prompt: "白天到黄昏\n黄昏到夜晚", transitionLines: ["白天到黄昏", "黄昏到夜晚"], duration: 5 });
    expect(args).toEqual([
      "multiframe2video", "--images=/a.png,/b.png,/c.png",
      "--transition-prompt=白天到黄昏", "--transition-prompt=黄昏到夜晚", "--poll=30",
    ]);
    expect(args).not.toContain("--prompt=白天到黄昏\n黄昏到夜晚");
  });

  it("3 图但过渡只给 1 句：用它补齐到 N-1=2 句", () => {
    const args = buildMultiframeArgs({ imagePaths: ["/a", "/b", "/c"], prompt: "渐变", transitionLines: ["渐变"], duration: 3 });
    expect(args.filter((a) => a.startsWith("--transition-prompt="))).toEqual(["--transition-prompt=渐变", "--transition-prompt=渐变"]);
  });

  it("4 图给 5 句：截断到 N-1=3 句", () => {
    const args = buildMultiframeArgs({ imagePaths: ["/a", "/b", "/c", "/d"], prompt: "p", transitionLines: ["1", "2", "3", "4", "5"], duration: 3 });
    expect(args.filter((a) => a.startsWith("--transition-prompt="))).toEqual(["--transition-prompt=1", "--transition-prompt=2", "--transition-prompt=3"]);
  });

  it("3 图无过渡行：用主提示当填充", () => {
    const args = buildMultiframeArgs({ imagePaths: ["/a", "/b", "/c"], prompt: "整体氛围", transitionLines: [], duration: 3 });
    expect(args.filter((a) => a.startsWith("--transition-prompt="))).toEqual(["--transition-prompt=整体氛围", "--transition-prompt=整体氛围"]);
  });
});
