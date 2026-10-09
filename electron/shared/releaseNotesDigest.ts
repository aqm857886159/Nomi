// 发版说明 → 更新弹窗 / 更新后卡片要显示的那几行。
//
// 输入是 electron-updater 从 GitHub Atom feed 读到的 HTML（GitHub 把 docs/release-notes/vX.md 渲染成的 HTML），
// 约定结构（scripts/check-release-notes.mjs 守门）：
//   <h1>Nomi vX — 中文标题句</h1>   <p>首段</p>   [<p>适用平台：Mac</p>]
//   <h2>中文分组</h2> <ul><li><strong>短语</strong>：正文</li>…</ul> …
//   <h2>What changed</h2> <p>English headline</p> <ul>…</ul>（或再按 <h3> 分组）
//
// 只取每条加粗短语、每组最多 N 条；正文丢掉。解析用 parse5（HTML 标准解析器，react-markdown 的
// rehype-raw 本来就在依赖树里），不手写正则状态机；正则只用来剥「（#953）」和句末标点这种纯文本清理。
// 结构对不上（没有 H1 / 没有英文段 / 列表项没加粗）时不硬凑：对应字段为空，界面只显示版本号和「完整说明」链接。
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { DigestGroup, LocaleDigest, UpdatePlatform, VersionNotes } from "./updateReminder";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

const MAX_GROUPS = 4;
const MAX_ITEMS_PER_GROUP = 3;
const ENGLISH_SECTION = /^what changed$/i;
const PLATFORM_LINE = /^(?:适用平台|平台|Platforms?)\s*[:：]\s*(.+)$/i;

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function textOf(node: Node): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterMap["textNode"]).value;
  if (!isElement(node)) return "";
  return node.childNodes.map(textOf).join("");
}

/** 「（#953）」「(#921、#934)」之类的 PR 号与句末标点。 */
function clean(text: string): string {
  return text
    .replace(/[（(]\s*#\d+(?:\s*[、,，]\s*#\d+)*\s*[）)]/g, "")
    .replace(/[。.:：；;，,\s]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 列表项里第一个加粗（只看这一项自己的内容，不下钻到它的子列表）。 */
function firstStrong(node: Element): string | null {
  for (const child of node.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === "ul" || child.tagName === "ol") continue;
    if (child.tagName === "strong" || child.tagName === "b") return textOf(child);
    const nested = firstStrong(child);
    if (nested !== null) return nested;
  }
  return null;
}

function listItems(list: Element): string[] {
  const items: string[] = [];
  for (const li of list.childNodes) {
    if (!isElement(li) || li.tagName !== "li") continue;
    const strong = firstStrong(li);
    if (strong) items.push(clean(strong));
  }
  return items.filter(Boolean);
}

type Block = { tag: string; element: Element };

function topLevelBlocks(html: string): Block[] {
  const fragment = parseFragment(html ?? "");
  return fragment.childNodes.filter(isElement).map((element) => ({ tag: element.tagName, element }));
}

function groupsOf(blocks: readonly Block[], headingTag: string): { groups: DigestGroup[]; lead: Block[] } {
  const groups: DigestGroup[] = [];
  const lead: Block[] = [];
  let heading: string | null = null;
  let items: string[] = [];
  let open = false;
  const flush = (): void => {
    if (open && (heading !== null || items.length)) groups.push({ heading, items: items.slice(0, MAX_ITEMS_PER_GROUP) });
  };
  for (const block of blocks) {
    if (block.tag === headingTag) {
      flush();
      heading = clean(textOf(block.element));
      items = [];
      open = true;
    } else if (block.tag === "ul" || block.tag === "ol") {
      if (!open) open = true; // 英文段第一个 ### 之前的列表：无名组
      items = items.concat(listItems(block.element));
    } else if (!open) {
      lead.push(block);
    }
  }
  flush();
  return { groups: groups.filter((group) => group.heading !== null || group.items.length > 0), lead };
}

function parsePlatforms(lead: readonly Block[]): UpdatePlatform[] | null {
  for (const block of lead) {
    if (block.tag !== "p") continue;
    const match = PLATFORM_LINE.exec(textOf(block.element).trim());
    if (!match) continue;
    const found = new Set<UpdatePlatform>();
    for (const token of match[1].split(/[、,，/／\s和与&]+/u)) {
      const key = token.trim().toLowerCase();
      if (key === "mac" || key === "macos") found.add("darwin");
      else if (key === "windows" || key === "win") found.add("win32");
      else if (key === "linux") found.add("linux");
    }
    return found.size ? [...found] : null;
  }
  return null;
}

/** 把一版发版说明的 HTML 摘成两种语言各自的摘要 + 适用平台。 */
export function digestReleaseNotesHtml(html: string, version: string): VersionNotes {
  const blocks = topLevelBlocks(html);
  const englishAt = blocks.findIndex((block) => block.tag === "h2" && ENGLISH_SECTION.test(textOf(block.element).trim()));

  const chineseBlocks = blocks.slice(0, englishAt >= 0 ? englishAt : blocks.length);
  const h1 = chineseBlocks.find((block) => block.tag === "h1");
  const h1Text = h1 ? textOf(h1.element) : "";
  const dash = h1Text.search(/\s[—–-]\s/);
  const zhTitle = dash >= 0 ? clean(h1Text.slice(dash + 3)) || null : null;
  const zh = groupsOf(chineseBlocks, "h2");

  let en: { groups: DigestGroup[]; lead: Block[] } = { groups: [], lead: [] };
  let enTitle: string | null = null;
  if (englishAt >= 0) {
    en = groupsOf(blocks.slice(englishAt + 1), "h3");
    const headline = en.lead.find((block) => block.tag === "p");
    enTitle = headline ? clean(textOf(headline.element)) || null : null;
  }

  const zhDigest: LocaleDigest = { title: zhTitle, groups: zh.groups.slice(0, MAX_GROUPS), hiddenGroups: Math.max(0, zh.groups.length - MAX_GROUPS) };
  const enDigest: LocaleDigest = { title: enTitle, groups: en.groups.slice(0, MAX_GROUPS), hiddenGroups: Math.max(0, en.groups.length - MAX_GROUPS) };
  return { version, zh: zhDigest, en: enDigest, platforms: parsePlatforms(zh.lead) };
}
