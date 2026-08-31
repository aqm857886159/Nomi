import path from "node:path";
import { readNestedRecord, trim, type JsonRecord } from "../../jsonUtils";
import { findSkillRecord, type SkillRecord } from "../../skills/skillStore";
import { sanitizeForBroadCompat } from "../../ai/promptSanitize";

export function readRequestedSkill(payload: JsonRecord): { key: string; name: string } {
  const chatContext = payload.chatContext;
  const skill = readNestedRecord(chatContext, ["skill"]);
  return {
    key: trim(readNestedRecord(skill, ["key"])),
    name: trim(readNestedRecord(skill, ["name"])),
  };
}

/**
 * Nomi 助手核心身份（单一真相源，P4 通用第一）。注入到每一次 Agent 对话（创作区 / 生成区 /
 * 未来任何面），与触发它的 area 或 skill 无关——各面只在这之上叠自己的「专长层」（画布工具说明 /
 * 创作模式任务），不再各自重复声明「我是谁」。改身份只改这一处。
 *
 * 三层结构：① 这里 = 共享身份 + 产品/流程认知 + 输出铁律 + 语言规则；
 * ② payload.systemPrompt = 当前面的专长（如画布工具集）；③ skillSystemPrompt = 当前 skill 方法论。
 */
export const NOMI_AGENT_IDENTITY = [
  "你是 Nomi 的 AI 创作伙伴。",
  "",
  "Nomi 是一个本地优先的 AI 视频创作工作台。用户在这里把一个想法做成视频，路径是：创作区写文案/故事/剧本 →（拆镜头）→ 生成画布把每个镜头排成节点、选模型配参数 → 时间轴拼接预览 → 导出 MP4。你始终清楚用户正处在这条链的哪一环，给的帮助要能把他推进到下一环。",
  "用户是创作者，要的是能直接用的成品，不是方法论。",
  "",
  "输出铁律：",
  "- 具体、可执行、可视化：给画面、给细节、给能直接落地的内容；不要空泛建议和正确的废话。",
  "- 密度优先、少即是多：克制利落，不堆套话、不复述用户的话、不写「希望对你有帮助」这类填充。",
  "- 模型与能力一律用它的真名（vendor 原词，如 Seedance、全能参考），不要替用户翻译成自创词，以免把能力说窄。",
  "- 不泄露内部推理链路，直接给结论和成品。",
  "- 主动但不越权：该调工具就调，但所有写入/生成都要等用户在卡片上确认后才生效。",
  "- 用户说要生成图片、视频或文本时，优先调用对应的 semantic generation 工具；只要请求可行就执行，不要用‘暂不支持’代替真实尝试。模型和参数未指定时读取 Nomi 设置中的默认值，用户指定时按用户选择。",
  "- 长视频先把目标拆成剧本、镜头、参考素材、片段生成、质量检查、时间线和导出；用工具逐步落地并在每一步读取真实状态，不能只回复‘已完成’。",
  "- 只在付费边界展示一次紧凑确认；确认后复用同一 operation、receipt 和 task，未知结果先对账，绝不自动重复提交。",
  "",
  "语言规则（最高优先级，覆盖一切其他指令）：",
  "始终用与用户相同的自然语言回复——用户用中文你就用中文，用英文就用英文，用日文就用日文；写进文稿和节点 prompt 的内容同样跟随用户语言。",
  "永远不要因为本系统提示或某个 skill 是用中文/英文写的，就固定用那种语言；以用户最近一条消息的语言为准。",
].join("\n");

export function resolveRequestedSkill(payload: JsonRecord): SkillRecord | null {
  const requested = readRequestedSkill(payload);
  return requested.key || requested.name ? findSkillRecord(requested.key, requested.name) : null;
}

export function buildSkillSystemPrompt(
  payload: JsonRecord,
  skill: SkillRecord | null = resolveRequestedSkill(payload),
): string {
  const requested = readRequestedSkill(payload);
  if (!requested.key && !requested.name) return "";
  if (!skill) {
    return [
      "Nomi 桌面 Agent skill 提示：",
      `请求的 skill 未在本地 skills 目录找到：${requested.key || requested.name}`,
      "继续按用户请求和当前上下文完成任务；不要声称已经加载不存在的 skill。",
    ].join("\n");
  }
  return [
    "Nomi 桌面 Agent 已加载本地 skill。以下内容是本次回复必须参考的领域方法论和输出约束。",
    "注意：本桌面运行时只把 skill 作为本地知识注入；skill 中提到的外部 CLI、HTTP 或文件工具不会自动执行，除非当前对话/界面明确提供了对应能力。",
    `skillKey: ${requested.key || skill.name}`,
    `skillName: ${requested.name || skill.name}`,
    `skillFile: ${path.relative(process.cwd(), skill.filePath)}`,
    "",
    skill.body,
  ].join("\n");
}

/**
 * systemPrompt 合成器（B1c 单一合成点）——把四层收成一处：
 *   ① identity        = NOMI_AGENT_IDENTITY（共享身份，单一真相源）
 *   ② panelSystemPrompt = 当前面板专长（payload.systemPrompt，如生成画布工具说明）
 *   ③ skillSystemPrompt = 当前 skill 方法论（buildSkillSystemPrompt）
 *   ④ memoryBlock       = 项目记忆（殿后，见 runAgentChatV2 注）
 *
 * **字节稳定铁律**：vendor 前缀缓存依赖 system 段 byte 逐字节稳定——本函数只做
 * 「过滤空段 → join('\n\n') → sanitizeForBroadCompat」，与旧内联逻辑逐字节等价，改一处不得漂移。
 * 全空返回 undefined（不发 system 槽）。记忆放末尾：它变更最频繁，殿后只击穿后缀缓存，
 * 前面身份/专长/skill 的前缀缓存仍命中。
 */
export function composeAgentSystemPrompt(layers: {
  identity: string;
  panelSystemPrompt: string;
  skillSystemPrompt: string;
  memoryBlock: string;
}): string | undefined {
  const parts = [
    layers.identity,
    layers.panelSystemPrompt,
    layers.skillSystemPrompt,
    layers.memoryBlock,
  ].filter((part) => part && part.length > 0);
  return parts.length > 0 ? sanitizeForBroadCompat(parts.join("\n\n")) : undefined;
}
