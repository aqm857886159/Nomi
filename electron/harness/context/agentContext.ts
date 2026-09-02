import path from "node:path";
import { readNestedRecord, trim, type JsonRecord } from "../../jsonUtils";
import { findSkillRecord, type SkillRecord } from "../../skills/skillStore";
import { sanitizeForBroadCompat } from "../../ai/promptSanitize";
import { getDesktopLocale } from "../../desktopLocale";

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
 * 三层结构：① 这里 = 共享身份 + 产品/流程认知 + 输出铁律（语言规则见 buildLanguageRule，跟界面语言走）；
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
  // 2026-08-28 用户实测截图：回复里逐条列出 `gen-v2-image-mtd0az16-76cu` 这类节点 id，
  // 并把待确认的工具 payload 原样抄成一段 JSON。渲染层早就把 id 翻成「镜1」了（toolCallSummary），
  // 但那只管 Nomi 自己的摘要——模型自己写的正文绕过它，机器串照样糊到用户脸上。
  "- 不把机器串摊给用户：节点/客户端 id、工具名、参数与 payload 的 JSON，一律不出现在回复正文里。提到某个镜头就用它的标题（「镜1」这类人话名），不要报 id。",
  "- 请用户确认计划时，用一两句人话说清「要做什么、动到哪几个镜头、会不会花钱」就够了；细节由确认卡片呈现，不要把计划的 JSON 再抄一遍给用户看。",
  "- 主动但不越权：该调工具就调，但所有写入/生成都要等用户在卡片上确认后才生效。",
].join("\n");

/**
 * 回复语言规则 —— **跟界面语言走，不写死**。
 *
 * 之前这条规则硬编码成「Respond in English by default」，而且身份层与合成器各存了一份。
 * 但 DEFAULT_LOCALE 仍是 zh-CN：中文界面的用户会拿到一个用英文回话、连分镜描述和提示词
 * 都写成英文的助手。语言是**用户已经在设置里表达过的偏好**，不该由提示词另开一套。
 *
 * 只在这里定义一次（P1：一条规则一个家），由 composeAgentSystemPrompt 殿后追加；
 * locale 从 electron-free 的 desktopLocale 读，与判官 prompt 的做法一致。
 */
export function buildLanguageRule(): string {
  return getDesktopLocale() === "en"
    ? [
        "Response-language rule (highest priority):",
        "Respond in English. Use another language only when the user explicitly requests it.",
        "This rule applies to every response, draft, shot description, and prompt, regardless of the language used by any skill or tool instruction.",
        // 关键一句:身份层/skill/工具说明大部分是中文,模型会**照着提示词的语言说话**。
        // 不点破「提示词的语言 ≠ 输出的语言」,它就会中英混着答(2026-08-28 用户实测:半中半英)。
        "Most of the instructions in this prompt are written in Chinese. That is an implementation detail of this app and carries no meaning about your output language: still answer in English.",
      ].join("\n")
    : [
        "回复语言铁律（最高优先级）：",
        "默认用简体中文回复。只有用户明确要求换语言时才换。",
        "这条对每一次回复、草稿、分镜描述和提示词都适用，不论 skill 或工具说明本身用的是什么语言。",
      ].join("\n");
}

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
  const contentParts = [
    layers.identity,
    layers.panelSystemPrompt,
    layers.skillSystemPrompt,
    layers.memoryBlock,
  ].filter((part) => part && part.length > 0);
  if (contentParts.length === 0) return undefined;
  // 语言规则**首尾各放一次**（同一份定义，P1 仍是一个家）。
  //
  // 为什么要两处：这套提示词的主体（身份层 295 个汉字 / skill / 工具说明）几乎全是中文，模型会照着
  // 提示词的语言说话。旧实现正是靠身份层尾部 + 合成器末尾**两处**英文规则把它压住的；我先前按
  // 「一条规则一个家」把身份层那份删了，只剩末尾一句，英文界面下当场退化成中英混答（用户实测）。
  // P1 反对的是**两份各自维护的定义**，不是同一份定义在长提示词里首尾各强调一次——那是 primacy/recency，
  // 是这段提示词在做的实事。所以：定义仍只有 buildLanguageRule 一处，注入两次。
  const languageRule = buildLanguageRule();
  return sanitizeForBroadCompat([languageRule, ...contentParts, languageRule].join("\n\n"));
}
