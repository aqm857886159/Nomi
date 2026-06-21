import { describe, expect, it } from "vitest";
import { parseEvoLinkAI, parseImgEdify, parseYouMind, parseSora2, parseSoraOfficial, splitBlocks } from "./promptParsers";

describe("splitBlocks", () => {
  it("按行首标题切块,每块含到下一标题前", () => {
    const md = "intro\n### A\nbody a\n### B\nbody b\n";
    const blocks = splitBlocks(md, "^### .+");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("body a");
    expect(blocks[0]).not.toContain("body b");
  });
});

describe("parseEvoLinkAI", () => {
  const base = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main";
  it("抓标题+代码块 prompt,封面从 case 号派生", () => {
    const md = `### Case 12: [赛博城市](https://x.com/a) (by [@u](https://x.com/u))\n\n**Prompt:**\n\`\`\`\na neon cyberpunk city at night\n\`\`\`\n`;
    const r = parseEvoLinkAI(md, base);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("赛博城市");
    expect(r[0].prompt).toBe("a neon cyberpunk city at night");
    expect(r[0].mediaUrl).toBe(`${base}/images/poster_case12/output.jpg`);
    expect(r[0].mediaType).toBe("image");
  });
  it("优先用 block 内的 img src", () => {
    const md = `### Case 3: [T](https://x.com/a)\n<img src="${base}/images/poster_case3/output.jpg" width="400">\n**Prompt:**\n\`\`\`\nhello\n\`\`\`\n`;
    expect(parseEvoLinkAI(md, base)[0].mediaUrl).toContain("poster_case3");
  });
  it("缺 prompt 的 block 跳过", () => {
    expect(parseEvoLinkAI("### Case 9: [无提示](https://x.com/a)\n只有标题\n", base)).toHaveLength(0);
  });
});

describe("parseImgEdify", () => {
  it("抓 **Prompt Text:** 行内码 + cdn 封面", () => {
    const md = `### 人物肖像\n- **Prompt Text:** \`a portrait of a woman\`\n<img src="https://cdn.imgedify.com/imgedify/images/x.jpeg" height="400">\n`;
    const r = parseImgEdify(md);
    expect(r).toHaveLength(1);
    expect(r[0].prompt).toBe("a portrait of a woman");
    expect(r[0].mediaUrl).toContain("cdn.imgedify.com");
  });
  it("缺封面跳过", () => {
    expect(parseImgEdify("### T\n- **Prompt Text:** `x`\n")).toHaveLength(0);
  });
});

describe("parseYouMind", () => {
  it("抓 No.N 标题 + #### Prompt 代码块 + cms 封面", () => {
    const md = `### No. 5: 水彩风\n\n#### 📖 Description\n\nsome desc\n\n#### 📝 Prompt\n\n\`\`\`\nwatercolor village morning\n\`\`\`\n\n#### 🖼️ Generated Images\n\n<img src="https://cms-assets.youmind.com/media/abc.jpg" width="700">\n`;
    const r = parseYouMind(md);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("水彩风");
    expect(r[0].prompt).toBe("watercolor village morning");
    expect(r[0].mediaUrl).toContain("cms-assets.youmind.com");
  });
});

describe("parseSora2", () => {
  it("抓代码块 prompt + twitter mp4", () => {
    const md = `### 东京漫步\n\n**Prompt:**\n\`\`\`\na walk through tokyo at dusk\n\`\`\`\n\n**Video Links:**\n- Sora 2: [View](https://video.twimg.com/amplify_video/1/x.mp4)\n`;
    const r = parseSora2(md);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("东京漫步");
    expect(r[0].prompt).toBe("a walk through tokyo at dusk");
    expect(r[0].mediaUrl).toContain("video.twimg.com");
    expect(r[0].mediaType).toBe("video");
  });
  it("缺 mp4 仍保留(mediaUrl 空,UI 占位)", () => {
    const md = `### 无媒体\n**Prompt:**\n\`\`\`\nsomething\n\`\`\`\n`;
    const r = parseSora2(md);
    expect(r).toHaveLength(1);
    expect(r[0].mediaUrl).toBe("");
  });
});

describe("parseSoraOfficial", () => {
  it("媒体锚定:> 引用 prompt + Generated Videos 链接,标题取 mp4 文件名", () => {
    const md = `> A stylish woman walks down a Tokyo street filled with neon.\n\nGenerated Videos: [link](https://cdn.openai.com/sora/videos/tokyo-walk.mp4)\n\n> Several giant wooly mammoths approach treading through a snowy meadow.\n\nGenerated Videos: [link](https://cdn.openai.com/sora/videos/wooly-mammoth.mp4)\n`;
    const r = parseSoraOfficial(md);
    expect(r).toHaveLength(2);
    expect(r[0].title).toBe("Tokyo Walk");
    expect(r[0].prompt).toContain("Tokyo street");
    expect(r[0].mediaUrl).toBe("https://cdn.openai.com/sora/videos/tokyo-walk.mp4");
    expect(r[1].title).toBe("Wooly Mammoth");
  });
  it("无 Generated Videos 链接的文本跳过", () => {
    expect(parseSoraOfficial("> just a quote\n\nsome text\n")).toHaveLength(0);
  });
});
