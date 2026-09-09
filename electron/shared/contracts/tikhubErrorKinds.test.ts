import { describe, expect, it } from "vitest";
import {
  tikhubErrorKindOf,
  formatTikhubErrorMessage,
  stripTikhubErrorMarker,
  TIKHUB_ERROR_KINDS,
} from "./tikhubErrorKinds";

describe("tikhubErrorKindOf — 跨 IPC 唯一一份 kind 提取器", () => {
  it("从 .kind 字段直读（同进程、未过 IPC 时）", () => {
    expect(tikhubErrorKindOf({ kind: "auth" })).toBe("auth");
    expect(tikhubErrorKindOf({ kind: "no-route", message: "连不上" })).toBe("no-route");
  });

  it("跨 IPC：.kind 被剥、message 是纯中文人话时，靠机读前缀还原（回归 2026-09-01 假绿修复）", () => {
    // 这是 walkthrough 抓到的真 bug：no-route 的人话 message 是中文 prose，不含 "no-route" 词，
    // 且 Electron 只保留 message、剥掉 .kind——旧逻辑于是退化成通用「保存失败」。机读前缀根治它。
    const ipcMessage = formatTikhubErrorMessage(
      "no-route",
      "连不上 TikHub：主线路和大陆加速线路都探测不通。请换个网络或代理后重试。",
    );
    expect(tikhubErrorKindOf({ message: ipcMessage })).toBe("no-route"); // 没有 .kind，仅靠 message 前缀
    // Electron 常再套一层前缀，前缀仍能被 includes 嗅到（宽松兜底）。
    expect(
      tikhubErrorKindOf({ message: `Error invoking remote method 'x': Error: ${ipcMessage}` }),
    ).toBe("no-route");
    // 每一类都要能跨 IPC 还原。
    for (const kind of TIKHUB_ERROR_KINDS) {
      expect(tikhubErrorKindOf({ message: formatTikhubErrorMessage(kind, "人话说明") })).toBe(kind);
    }
  });

  it("认不出 → null（调用方兜底到 saveFailed/bad-response 文案）", () => {
    expect(tikhubErrorKindOf({ message: "something unrelated" })).toBeNull();
    expect(tikhubErrorKindOf(null)).toBeNull();
    expect(tikhubErrorKindOf("plain string")).toBeNull();
    // 不认非法 kind 值（防脏数据当合法 kind）。
    expect(tikhubErrorKindOf({ kind: "totally-made-up" })).toBeNull();
    expect(tikhubErrorKindOf({ message: "[tikhub:made-up] x" })).toBeNull();
  });

  it("stripTikhubErrorMarker 去掉机读前缀只留人话（渲染层若直接显示 message）", () => {
    expect(stripTikhubErrorMarker(formatTikhubErrorMessage("auth", "Key 无效"))).toBe("Key 无效");
    expect(stripTikhubErrorMarker("没有前缀的普通串")).toBe("没有前缀的普通串");
  });

  it("kind 清单覆盖全部十类失败", () => {
    expect([...TIKHUB_ERROR_KINDS]).toEqual([
      "missing-key",
      "auth",
      "quota",
      "not-found",
      "unsupported-platform",
      "no-play-url",
      // 2026-09-07 新增：429 限流。刻意不并进 quota——两者处置相反
      // （quota 要去 tikhub.io 充值，这个只要等几秒重试）。
      "rate-limited",
      "upstream",
      "no-route",
      "bad-response",
    ]);
  });
});
