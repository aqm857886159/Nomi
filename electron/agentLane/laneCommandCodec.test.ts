// 过桥命令解码。判据和 electron 绑定分开住，就是为了这个文件能真的跑起来
// （`laneIpc.ts` 顶部那行 `import { ipcMain } from "electron"` 会让测试直接炸）。
import { describe, expect, it } from "vitest";

import { LaneCommandError, parseLaneCommand } from "./laneCommandCodec";

describe("lane command codec", () => {
  it("accepts the only two things the renderer is allowed to say", () => {
    expect(parseLaneCommand({ kind: "prompt", text: "Append a line." })).toEqual({ kind: "prompt", text: "Append a line." });
    expect(parseLaneCommand({ kind: "abort" })).toEqual({ kind: "abort" });
  });

  it("drops everything else the renderer tries to mint", () => {
    // 今天渲染层在桥的不可信一侧铸造 thread / turn / item / executionToken / contextRef
    // （#546 V10）。新通路里那些字段连**通过**都通不过——不是被忽略，是根本没有它们的位置。
    const smuggled = parseLaneCommand({
      kind: "prompt", text: "hi",
      turnId: "renderer-minted", executionToken: "renderer-minted", approvalPolicy: { mode: "project" },
    });
    expect(smuggled).toEqual({ kind: "prompt", text: "hi" });
    expect(Object.keys(smuggled)).toEqual(["kind", "text"]);
  });

  it("throws rather than guessing a default", () => {
    // 猜一个默认值的代价是：一条解不出来的命令继续往下走，最后变成一次没人预期的模型调用。
    for (const wire of [undefined, null, "prompt", [], { kind: "steer" }, { kind: "prompt" }, { kind: "prompt", text: "   " }]) {
      expect(() => parseLaneCommand(wire)).toThrow(LaneCommandError);
    }
  });

  it("names the unknown kind in the error, because a codec that says only 'invalid' is useless", () => {
    expect(() => parseLaneCommand({ kind: "steer" })).toThrow(/steer/);
  });

  it("caps prompt size, so one message cannot become a free memory amplifier", () => {
    const under = "x".repeat(128 * 1024);
    expect(parseLaneCommand({ kind: "prompt", text: under })).toEqual({ kind: "prompt", text: under });
    expect(() => parseLaneCommand({ kind: "prompt", text: `${under}y` })).toThrow(LaneCommandError);
  });

  it("measures the cap in bytes, not characters", () => {
    // 一个中文字符是 3 字节。按字符数算的上限在中文输入下是它自称的三倍——
    // 而 Nomi 的默认语言就是中文，所以这条不是边角情况。
    const chinese = "文".repeat(44_000); // 132 000 字节 > 128 KiB，但只有 44 000 个字符
    expect(chinese.length).toBeLessThan(128 * 1024);
    expect(() => parseLaneCommand({ kind: "prompt", text: chinese })).toThrow(LaneCommandError);
  });
});
