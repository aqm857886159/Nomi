import { describe, expect, it } from "vitest";
import { clampSeekSeconds } from "./extractVideoFrame";

describe("clampSeekSeconds：截帧的秒数不许落在 EOF 之后", () => {
  it("时长之内原样放行", () => {
    expect(clampSeekSeconds(7.2, 12)).toBe(7.2);
    expect(clampSeekSeconds(0, 12)).toBe(0);
  });
  it("播放头停在片尾（== 时长）或超出：夹到末尾前 0.1 秒（和尾帧同一个位置）", () => {
    expect(clampSeekSeconds(12, 12)).toBeCloseTo(11.9, 6);
    expect(clampSeekSeconds(99, 12)).toBeCloseTo(11.9, 6);
  });
  it("负数夹到 0；时长未知时原样放行，交给 ffmpeg 判", () => {
    expect(clampSeekSeconds(-3, 12)).toBe(0);
    expect(clampSeekSeconds(5, 0)).toBe(5);
    expect(clampSeekSeconds(5, Number.NaN)).toBe(5);
  });
  it("比 0.1 秒还短的片子：不出负数", () => {
    expect(clampSeekSeconds(1, 0.05)).toBe(0);
  });
});
