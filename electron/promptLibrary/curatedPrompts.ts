import { resolveEffectSlots } from "../shared/effectSlots";
import { skillPreviewUrl } from "../skills/skillPreview";
import type { SkillRecord } from "../skills/skillStore";
import type { LibraryPrompt } from "./promptLibraryTypes";

/** SKILL.md remains the body owner; the library receives a projection, never a second content file. */
export function getCuratedPrompts(records: readonly SkillRecord[]): LibraryPrompt[] {
  return records.flatMap((record) => {
    const item = record.curation;
    if (record.origin !== "builtin" || record.manifestError || item?.kind !== "effect") return [];
    const promptType = item.appliesTo.find((kind) => kind === "image" || kind === "video");
    // Text remains a valid Skill modality, but the current prompt panel only creates image/video nodes.
    if (!promptType) return [];
    // 方法正文来自 pi 的加载器（已去 frontmatter）：这里不再养第二份 stripper。
    // 插槽在这里展开（唯一出口）：没人绑定值时用通用说法，不把 `{角色名}` 原文交出去。
    const prompt = resolveEffectSlots(record.content.trim(), item.slots);
    return [{
      id: record.directoryName,
      title: item.title["zh-CN"],
      prompt,
      promptType,
      mediaType: item.preview?.type ?? "image",
      mediaUrl: skillPreviewUrl(record),
      origin: "public" as const,
      source: item.group["zh-CN"],
      sourceId: "builtin-curated-effects",
      sourceUrl: item.source.url,
      tags: [item.group["zh-CN"], item.group.en, ...item.appliesTo],
      curation: item,
    }];
  });
}
