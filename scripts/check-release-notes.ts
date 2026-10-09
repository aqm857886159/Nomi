// 发版说明门岗：应用内更新弹窗 / 「已更新」卡 / 热修横幅都从 docs/release-notes/vX.md 摘要，
// 结构不对界面就只剩一个空壳（0.23.0 缺英文段，英文用户的更新弹窗什么都没有）。
// 从 0.23.0 起每份说明必须有：中文标题句（H1「—」后）、英文标题句（「What changed」下第一段）、
// 至少一条加粗开头的中文条目和英文条目；写了「适用平台：…」就必须认得出是哪个平台。
// 解析和运行时共用 electron/shared/releaseNotesDigest.ts，门岗与产品对「合格」的定义只有一份。
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { digestReleaseNotesHtml } from "../electron/shared/releaseNotesDigest";
import { compareVersions } from "../electron/shared/updateReminder";

const FIRST_GATED_VERSION = "0.23.0";
const root = path.resolve(process.cwd(), "docs/release-notes");
const problems: string[] = [];

for (const file of fs.readdirSync(root).sort()) {
  const match = /^v(\d+\.\d+\.\d+)\.md$/.exec(file);
  if (!match || compareVersions(match[1], FIRST_GATED_VERSION) < 0) continue;
  const markdown = fs.readFileSync(path.join(root, file), "utf8");
  const notes = digestReleaseNotesHtml(marked.parse(markdown, { async: false }), match[1]);
  const fail = (message: string): void => { problems.push(`docs/release-notes/${file}：${message}`); };
  if (!notes.zh.title) fail("缺中文标题句（H1 写成「# Nomi vX — 标题」）");
  if (!notes.en.title) fail("缺英文标题句（「## What changed」下面先写一段英文一句话标题）");
  if (!notes.zh.groups.some((group) => group.items.length > 0)) fail("中文段没有加粗开头的条目（`- **短语**：说明`）");
  if (!notes.en.groups.some((group) => group.items.length > 0)) fail("英文段没有加粗开头的条目（`- **Phrase**: detail`）");
  if (/^(?:适用平台|平台|Platforms?)\s*[:：]/im.test(markdown) && notes.platforms === null) fail("「适用平台」写了但认不出平台（可用 Mac / Windows / Linux）");
}

if (problems.length) {
  console.error(`check-release-notes: ${problems.length} 处发版说明不合格\n${problems.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("check-release-notes: ok");
