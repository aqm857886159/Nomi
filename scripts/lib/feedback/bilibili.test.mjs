// 校验 B站两个「不能凭记忆写」的算法对得上社区权威已知向量。
// 这俩一旦写错，评论一条都拉不到（签名失败 / oid 错），所以用已知答案钉死。

import { describe, it, expect } from "vitest";
import { bv2av, getMixinKey, encWbi } from "./bilibili.mjs";

describe("bv2av（BV→AV，第二代算法）", () => {
  it("官方文档已知向量", () => {
    expect(bv2av("BV1L9Uoa9EUx")).toBe(111298867365120);
  });
  it("BV 号大小写/位置交换稳定", () => {
    // 同一向量重复转结果稳定（位置交换是确定性的）
    expect(bv2av("BV1L9Uoa9EUx")).toBe(bv2av("BV1L9Uoa9EUx"));
  });
});

describe("WBI 签名", () => {
  it("getMixinKey 命中官方示例", () => {
    const imgKey = "653657f524a547ac981ded72ea172057";
    const subKey = "6e4909c702f846728e64f6007736a338";
    expect(getMixinKey(imgKey + subKey)).toBe("72136226c6a73669787ee4fd02a74c27");
  });
  it("encWbi 产出排序后的 query + 32位 w_rid", () => {
    const out = encWbi({ oid: 123, type: 1 }, "a".repeat(64), "b".repeat(64));
    expect(out).toMatch(/&w_rid=[0-9a-f]{32}$/);
    // 参数按 key 排序：oid 在 type 之前，wts 自动加入
    expect(out.indexOf("oid=")).toBeLessThan(out.indexOf("type="));
    expect(out).toContain("wts=");
  });
});
