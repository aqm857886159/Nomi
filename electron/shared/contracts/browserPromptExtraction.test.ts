// 卡上「读哪个页面的哪张图」两行的格式只有一个主人（本合同）：主进程编、渲染层的卡解，这里钉住往返与两行怎么写。
import { describe, expect, it } from "vitest";
import {
  decodePromptExtractionSubject,
  encodePromptExtractionSubject,
  promptExtractionImageLabel,
  promptExtractionPageLabel,
  promptExtractionSubjectOf,
} from "./browserPromptExtraction";

describe("浏览器提取：卡上两行的编码", () => {
  it("编了能原样解回来（含中文、引号、空图片 = 截图）", () => {
    for (const subject of [
      { page: "photos.example", image: "harbor dawn.jpg" },
      { page: "例子.cn", image: "海港 \"清晨\".png" },
      { page: "posters.example", image: "" },
    ]) {
      expect(decodePromptExtractionSubject(encodePromptExtractionSubject(subject))).toEqual(subject);
    }
  });

  it("不是这个格式、JSON 坏了、字段不全：解不开（卡据此不问人）", () => {
    expect(decodePromptExtractionSubject("a quiet harbor")).toBeNull();
    expect(decodePromptExtractionSubject(undefined)).toBeNull();
    const encoded = encodePromptExtractionSubject({ page: "a", image: "b" });
    expect(decodePromptExtractionSubject(`${encoded.slice(0, encoded.indexOf("{"))}{oops`)).toBeNull();
    expect(decodePromptExtractionSubject(`${encoded.slice(0, encoded.indexOf("{"))}{"page":"a"}`)).toBeNull();
  });

  it("来源页只写主机名；不是地址就写缩短的原文；没有就空", () => {
    expect(promptExtractionPageLabel("https://evil.example/x?y=1")).toBe("evil.example");
    expect(promptExtractionPageLabel("not a url")).toBe("not a url");
    expect(promptExtractionPageLabel("")).toBe("");
  });

  it("图片写原图文件名（解码）；取不到文件名写主机 + 路径；data URL 只写到媒体类型；截图为空", () => {
    expect(promptExtractionImageLabel("https://cdn.example/img/harbor%20dawn.jpg?w=800")).toBe("harbor dawn.jpg");
    expect(promptExtractionImageLabel("https://cdn.example/")).toBe("cdn.example/");
    expect(promptExtractionImageLabel("data:image/png;base64,AAAA")).toBe("data:image/png");
    expect(promptExtractionImageLabel("")).toBe("");
    expect(promptExtractionImageLabel(`https://cdn.example/${"a".repeat(200)}.png`)).toHaveLength(80);
  });

  it("subject 由两个地址算出", () => {
    expect(promptExtractionSubjectOf({ pageUrl: "https://photos.example/a", imageSourceUrl: "https://cdn.photos.example/b.jpg" }))
      .toEqual({ page: "photos.example", image: "b.jpg" });
  });
});
