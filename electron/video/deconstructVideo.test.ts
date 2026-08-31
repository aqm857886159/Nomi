import { describe, expect, it } from "vitest";
import { buildShotAnalysisPrompt } from "./deconstructVideo";
import { parseLooseJsonObject } from "../jsonUtils";

const shot = { index: 3, startSeconds: 4, endSeconds: 6.5 };

describe("buildShotAnalysisPrompt", () => {
  it("说清「这几帧是同一镜」——否则模型会当成 N 个镜头分别描述", () => {
    const p = buildShotAnalysisPrompt(shot, 3, []);
    expect(p).toContain("同一个镜头");
    expect(p).toContain("3 帧");
    expect(p).toContain("不要当成 3 个镜头");
  });

  it("带上镜号和时间区间（模型据此判断这镜在片中的位置）", () => {
    expect(buildShotAnalysisPrompt(shot, 3, [])).toContain("第 3 个镜头（4.0s–6.5s）");
  });

  it("要求把**所有帧**里出现过的屏幕文字都收进来（单帧会漏快闪字幕）", () => {
    expect(buildShotAnalysisPrompt(shot, 3, [])).toContain("所有帧里出现过的");
  });

  it("六个内置字段都在 schema 里", () => {
    const p = buildShotAnalysisPrompt(shot, 3, []);
    for (const key of ["shotSize", "mood", "visual", "onScreenText", "imagePrompt", "motionPrompt"]) {
      expect(p).toContain(`"${key}"`);
    }
  });

  it("自定义列**动态进 schema** —— 这是「加一列=告诉 AI 多看一个维度」的实现点", () => {
    const p = buildShotAnalysisPrompt(shot, 3, [{ name: "材质细节", hint: "关注面料/反光/磨砂质感" }]);
    expect(p).toContain('"材质细节"');
    expect(p).toContain("关注面料/反光/磨砂质感");
  });

  it("自定义列没写说明 → 用列名兜底，不产出空 hint", () => {
    const p = buildShotAnalysisPrompt(shot, 3, [{ name: "上脚感" }]);
    expect(p).toContain('"上脚感": "该镜的「上脚感」"');
  });

  it("空列名被过滤掉，不污染 schema", () => {
    const p = buildShotAnalysisPrompt(shot, 3, [{ name: "   ", hint: "x" }]);
    expect(p).not.toContain('"   "');
  });

  it("没有自定义列时 schema 结尾干净（不留悬空逗号）", () => {
    const p = buildShotAnalysisPrompt(shot, 3, []);
    expect(p).not.toMatch(/,\s*\}$/u);
  });
});

describe("parseLooseJsonObject：容忍模型的 markdown 习惯", () => {
  it("裸 JSON", () => {
    expect(parseLooseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("```json 围栏（写死「不要 markdown」也照样会出现，必须在解析层容忍）", () => {
    expect(parseLooseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLooseJsonObject('```\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("前后有寒暄", () => {
    expect(parseLooseJsonObject('好的，结果如下：\n{"shotSize":"特写"}\n希望有帮助')).toEqual({ shotSize: "特写" });
  });

  it("嵌套对象不被内部的 } 截断（取的是最后一个 }）", () => {
    expect(parseLooseJsonObject('{"a":{"b":1},"c":2}')).toEqual({ a: { b: 1 }, c: 2 });
  });

  it("解不出返回 null，让调用方走「这一镜没拆出来」的降级，而不是整批炸掉", () => {
    expect(parseLooseJsonObject("模型今天不想说话")).toBeNull();
    expect(parseLooseJsonObject('{"broken":')).toBeNull();
    expect(parseLooseJsonObject("")).toBeNull();
    expect(parseLooseJsonObject(null)).toBeNull();
  });

  it("顶层是数组 → null（我们要的是对象）", () => {
    expect(parseLooseJsonObject("[1,2,3]")).toBeNull();
  });
});
