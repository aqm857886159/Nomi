import { describe, expect, it } from "vitest";
import { digitFormattingChars, editDistance, normalizeForScoring, scoreAgainstReference } from "./local-speech-cer";

/**
 * 量具自己的测试。为什么必须有：CER 是产品口径的依据，而**口径变了、数字跟着变，却没有任何东西会红**——
 * 2026-09-18 之前那个 0.065 无人能复现，正是因为算法与参照都没进仓库。这些用例把文件头那几条
 * 「做什么/不做什么」的规范化决定钉住：有人哪天顺手把繁体折成简体、或把 35 和 thirty-five 当成相同，
 * 这里当场红，而不是让一份悄悄变好看的数字流到方案文档里。
 */
describe("本地转写 CER 量具", () => {
  it("规范化：去空白、去标点、英文小写、全角折成半角（口径第 1 条）", () => {
    expect(normalizeForScoring("Hello, World!")).toBe("helloworld");
    expect(normalizeForScoring("你好，世界。")).toBe("你好世界");
    expect(normalizeForScoring("ＡＢＣ１２３")).toBe("abc123");
    // 断词差异不算错：这正是去空白的目的
    expect(normalizeForScoring("web coding")).toBe(normalizeForScoring("webcoding"));
  });

  it("**不**把繁体折成简体——小档位对普通话输出繁体是砍掉它的理由之一，折叠等于把缺陷藏进量具（口径第 3 条）", () => {
    expect(normalizeForScoring("學習")).not.toBe(normalizeForScoring("学习"));
    expect(scoreAgainstReference("学习", "學習").cer).toBe(1);
  });

  it("**不**把 35 和 thirty-five 当成相同——数字写法是用户在稿子里看得见的差别（口径第 3 条）", () => {
    expect(scoreAgainstReference("thirty-five", "35").cer).toBeGreaterThan(0);
    expect(digitFormattingChars("thirty-five", "35")).toBe(2);
    expect(digitFormattingChars("35", "35")).toBe(0);
  });

  it("编辑距离按字符算，增删改各记 1（口径第 2 条）", () => {
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("abc", "abd")).toBe(1);
    expect(editDistance("abc", "ab")).toBe(1);
    expect(editDistance("ab", "abc")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });

  it("CER = 编辑距离 / 参照字数，中文按字符——一堂客→一堂课就是 1 个字的错", () => {
    const { cer, distance, referenceChars } = scoreAgainstReference("一堂课卖得出去", "一堂客卖得出去");
    expect(distance).toBe(1);
    expect(referenceChars).toBe(7);
    expect(cer).toBeCloseTo(1 / 7, 6);
  });

  it("逐字相同的稿子 CER 为 0（冻结稿首次入库就该是这个数，不是量具坏了）", () => {
    expect(scoreAgainstReference("完全一样的一段话", "完全一样的一段话").cer).toBe(0);
  });

  it("参照为空时不除零", () => {
    expect(scoreAgainstReference("", "随便什么").cer).toBe(0);
  });
});
