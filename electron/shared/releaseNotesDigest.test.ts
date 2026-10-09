import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { describe, expect, it } from "vitest";
import { deriveHotfixBanner, deriveUpdatedCard, isHotfixVersion, shortVersion, UPDATER_INITIAL_STATE } from "./updateReminder";
import { digestReleaseNotesHtml } from "./releaseNotesDigest";

// 真实发版说明做输入：生产里 electron-updater 给的是 GitHub 把这份 md 渲染出来的 HTML，
// 这里用 marked 渲染同一份 md 得到同形状的 HTML；约定结构变了这里先红。
function digestOf(version: string) {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), `docs/release-notes/v${version}.md`), "utf8");
  return digestReleaseNotesHtml(marked.parse(markdown, { async: false }), version);
}

describe("digestReleaseNotesHtml · 真实发版说明", () => {
  it("0.23.0 中文：标题句、按二级标题分组、每组最多 3 条、只取加粗短语、剥 PR 号", () => {
    const { zh } = digestOf("0.23.0");
    expect(zh.title).toBe("逐张确认，说到做到");
    expect(zh.groups.map((group) => group.heading)).toEqual([
      "Agent 生成前的确认卡",
      "网络出问题时不重复提交",
      "用国内地址也能传参考图",
      "生成途中切项目",
    ]);
    expect(zh.groups[0].items).toEqual(["每张单独决定", "中途点 × 就停"]);
    expect(zh.groups[1].items).toEqual(["请求发出去以后连接断了，不再自动重发", "只有确定没发出去才会自动重试", "提交卡住会超时"]);
    expect(zh.hiddenGroups).toBeGreaterThan(0);
    for (const group of zh.groups) for (const item of group.items) expect(item).not.toMatch(/#\d+|\*\*|[。.]$/);
  });

  it("0.23.0 英文：有标题句和按 ### 分组的条目", () => {
    const { en } = digestOf("0.23.0");
    expect(en.title).toBe("Confirm each shot one by one. Stop means stop, and when Nomi is unsure it says so");
    expect(en.groups[0]).toEqual({ heading: "Agent confirmation card", items: ["Decide per shot", "Closing stops it at once"] });
  });

  it("0.23.1 两种语言各取各的段，适用平台只有 Mac", () => {
    const notes = digestOf("0.23.1");
    expect(notes.zh.title).toBe("Mac 升级与退出热修");
    expect(notes.zh.groups).toEqual([{ heading: "修了什么", items: ["安装更新后项目打不开", "旧版 Agent 记录拖住项目", "点「退出」没反应"] }]);
    expect(notes.en.title).toBe("Mac hotfix: upgrading, opening old projects, and quitting now work");
    expect(notes.en.groups).toEqual([{ heading: null, items: ["Projects open after an interrupted update", "Older Agent receipts no longer block a project", "Quit no longer gets stuck"] }]);
    expect(notes.platforms).toEqual(["darwin"]);
    expect(digestOf("0.23.0").platforms).toBeNull();
  });

  it("子列表里的加粗不算这一条（只看每条自己的第一个加粗）", () => {
    const html = "<h2>画布</h2><ul><li><strong>节点更清爽（#953）。</strong><ul><li><strong>子项</strong></li></ul></li><li>正文里的<strong>加粗</strong></li></ul>";
    expect(digestReleaseNotesHtml(html, "1.0.0").zh.groups).toEqual([{ heading: "画布", items: ["节点更清爽", "加粗"] }]);
  });
});

describe("digestReleaseNotesHtml · 结构对不上", () => {
  it("空串 / 纯文本 / 没有加粗的列表 → 空结果，不抛", () => {
    expect(digestReleaseNotesHtml("", "1.0.0").zh).toEqual({ title: null, groups: [], hiddenGroups: 0 });
    expect(digestReleaseNotesHtml("Nomi 修了几个问题", "1.0.0").en).toEqual({ title: null, groups: [], hiddenGroups: 0 });
    expect(digestReleaseNotesHtml("<h2>修了什么</h2><ul><li>没有加粗</li></ul>", "1.0.0").zh.groups).toEqual([{ heading: "修了什么", items: [] }]);
  });

  it("英文段第一个 ### 之前的列表归无名组", () => {
    const html = "<h1>Nomi v1 — 标题</h1><h2>What changed</h2><p>Headline</p><ul><li><strong>Loose</strong> one</li></ul><h3>Canvas</h3><ul><li><strong>A</strong>: a</li></ul>";
    const { en } = digestReleaseNotesHtml(html, "1.0.0");
    expect(en.title).toBe("Headline");
    expect(en.groups).toEqual([{ heading: null, items: ["Loose"] }, { heading: "Canvas", items: ["A"] }]);
  });
});

describe("热修横幅与更新后卡片的取舍", () => {
  const v231 = digestOf("0.23.1");
  const memory = { dismissedBanners: [], updatedCard: null };
  const available = { ...UPDATER_INITIAL_STATE, phase: "available" as const, latestVersion: "0.23.1", notes: [v231] };

  it("热修版 + 适用本平台 + 没 ✕ 过 → 出，文字是当前语言的标题句", () => {
    expect(deriveHotfixBanner(available, memory, "darwin", "zh")).toEqual({ version: "0.23.1", headline: "Mac 升级与退出热修" });
    expect(deriveHotfixBanner(available, memory, "darwin", "en")?.headline).toBe("Mac hotfix: upgrading, opening old projects, and quitting now work");
  });

  it("只修 Mac 的热修在 Windows 不出；✕ 过不再出；攒批版不出；不是 available 不出", () => {
    expect(deriveHotfixBanner(available, memory, "win32", "zh")).toBeNull();
    expect(deriveHotfixBanner(available, { dismissedBanners: ["0.23.1"], updatedCard: null }, "darwin", "zh")).toBeNull();
    expect(deriveHotfixBanner({ ...available, latestVersion: "0.24.0", notes: [{ ...v231, version: "0.24.0" }] }, memory, "darwin", "zh")).toBeNull();
    expect(deriveHotfixBanner({ ...available, phase: "downloading" }, memory, "darwin", "zh")).toBeNull();
  });

  it("没有标题句就不出横幅（不拿版本号凑数）", () => {
    const bare = { ...v231, zh: { ...v231.zh, title: null } };
    expect(deriveHotfixBanner({ ...available, notes: [bare] }, memory, "darwin", "zh")).toBeNull();
  });

  it("更新后卡片：跳版合成（从 A 到 B，标题取最新，条目从新到旧取 3 条）；只升一个补丁版不写「从」", () => {
    const merged = deriveUpdatedCard({ fromVersion: "0.22.5", toVersion: "0.23.1", notes: [v231, digestOf("0.23.0")] }, "zh");
    expect(merged).toEqual({
      fromVersion: "0.22.5",
      toVersion: "0.23.1",
      headline: "Mac 升级与退出热修",
      items: ["安装更新后项目打不开", "旧版 Agent 记录拖住项目", "点「退出」没反应"],
    });
    expect(deriveUpdatedCard({ fromVersion: "0.23.0", toVersion: "0.23.1", notes: [v231] }, "en")?.fromVersion).toBeNull();
    expect(deriveUpdatedCard(null, "zh")).toBeNull();
  });

  it("热修 = 第三位非 0；胶囊只在 .0 时省略第三位", () => {
    expect(isHotfixVersion("0.23.1")).toBe(true);
    expect(isHotfixVersion("0.24.0")).toBe(false);
    expect(shortVersion("0.24.0")).toBe("0.24");
    expect(shortVersion("0.23.1")).toBe("0.23.1");
  });
});
