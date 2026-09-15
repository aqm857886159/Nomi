import path from "node:path";

import { readNestedRecord, trim, type JsonRecord } from "../../jsonUtils";
import { skillMarkdownWithoutFrontmatter } from "../../skills/skillFrontmatter";
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
  // 2026-09-10 真机：safe-auto 档下建草稿（nomi_generation_plan create）是 reversible_local，自动放行、
  // 面板上根本没有确认卡。旧版铁律写「所有写入/生成都要等用户在卡片上确认」，与运行时自相矛盾，模型据此
  // 把「建了草稿」说成「已提交生成，去右侧预览区看结果」，还让用户去找一张不存在的卡。规则必须如实描述
  // 两类动作的真实分界：不花钱的本地写入立刻生效，花钱的生成才等确认卡。
  "- 主动但不越权：该调工具就调。建草稿、改草稿这类不花钱的本地改动会立刻生效，不需要确认；只有付费生成要等用户在确认卡上点头之后才开始。",
  "- 建好草稿只能说「草稿已建好，模型和参数以确认卡为准」，绝不能说「已提交」「已开始生成」「去预览区看结果」——生成还没开始，预览区也不会有东西。",
  "- 如果模型是你替用户选的，要明说这是你选的、以及为什么这么选，别让用户以为是他自己定的。",
  "",
  // 2026-09-15 真实模型实测（22 句 · `docs/evidence/2026-09-15-skill-real-run/`）：在一个**空项目**里说
  // 「给我做一条 30 秒的雨夜便利店短片」，模型 3/4 会自己去读对的技能（索引这条路是通的），但
  // **视觉锚 0/5**——唯一真的把镜头建出来的那一轮，4 个镜头全是 text_to_video，没有任何锚、没有任何
  // 引用。这与 2026-09-12 用户截图里 Agent 自己那句「镜头语言规则用了、视觉锚引用没用上」是同一件事。
  // 它不是不知道方法（读到的技能里写着），是没有一条**它每次都看得见**的规矩说「锚是先决条件」。
  // 所以这三句放在身份层，不放在某个 skill 里：一致性是 Nomi 这个产品的事，不是某种片型的事。
  "出片原则（每次都适用）：",
  "- 一次要出两个以上镜头时，先建一个视觉锚（人物卡或场景定场图），再让后续镜头**引用**它（图生视频 / 参考槽）。每镜各自文生视频等于同一部片子里换了几个人、换了几座城——这是用户最常抱怨的那个问题。",
  "- 用户已经给了图或素材时，它就是锚：真的挂到参考槽/参考边上。只把它写进提示词文字里不算用上——模型看不见你在文字里提过它。",
  "- 只有在用户明确说不要一致性、或这条片子本来就没有可复现的主体（纯风景快剪）时才跳过锚；跳过就在回复里说一句为什么跳过。",
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
        "Preserve user-provided titles, names, captions and dialogue verbatim unless the user asks to rewrite or translate them.",
        "Exception (no exception to the exception): every prompt you write for image/video/audio generation must be written in Simplified Chinese, regardless of the response language. The user reads and edits those prompts directly; English prompts force them to reach for a dictionary.",
        "This rule applies to every response, draft, shot description, and prompt, regardless of the language used by any skill or tool instruction.",
        // 关键一句:身份层/skill/工具说明大部分是中文,模型会**照着提示词的语言说话**。
        // 不点破「提示词的语言 ≠ 输出的语言」,它就会中英混着答(2026-08-28 用户实测:半中半英)。
        "Most of the instructions in this prompt are written in Chinese. That is an implementation detail of this app and carries no meaning about your output language: still answer in English.",
      ].join("\n")
    : [
        "回复语言铁律（最高优先级）：",
        "默认用简体中文回复。只有用户明确要求换语言时才换。",
        "用户给定的标题、名称、字幕和台词保持原文，除非用户要求改写或翻译；界面语言与示例语言不能覆盖这些字段。",
        "送进生成模型的提示词（图/视频/音频的生成 prompt）一律用简体中文书写，与回复语言无关——用户要直接阅读和修改它们，英文提示词等于让他们查词典。",
        "这条对每一次回复、草稿、分镜描述和提示词都适用，不论 skill 或工具说明本身用的是什么语言。",
      ].join("\n");
}

export function resolveRequestedSkill(payload: JsonRecord): SkillRecord | null {
  const requested = readRequestedSkill(payload);
  return requested.key || requested.name ? findSkillRecord(requested.key, requested.name) : null;
}

/**
 * 用户为**这一轮**挂的那条技能，注入成系统提示词的一段。**全仓唯一的技能注入点。**
 *
 * ── 它在解决哪个真实摩擦（D6 ①）──
 *
 * 用户在 composer 里点了「电影分镜」，然后说「这段剧本帮我做成分镜」。在 2026-09-15 之前，
 * 这条技能是这样进提示词的（`laneDesktopRuntime.ts` 两处）：
 *
 *     systemPrompt: [next.systemPrompt, skill?.body].filter(Boolean).join('\n\n')
 *
 * 也就是把整份 `SKILL.md` 原文（含 frontmatter）拼在面板提示词后面，**一个字的交代都没有**。
 * 模型看到的是：一段画布工具说明，然后突然一块 `license: Apache-2.0` / `source:` / `preview:`，
 * 再然后一份标题叫「电影分镜」的 markdown。没有任何东西告诉它：
 *   ① 这是用户**为这一轮点的**，不是背景资料；
 *   ② 它规定的画幅/时长/模式要**写进工具入参**，不是在正文里说一句「用宽屏」就算；
 *   ③ 用户要在回复里**看得出**它被用了。
 *
 * 症状就是用户 2026-09-10 的原话：「用了一个电影分镜 skill，但他和我生成出来的东西提示词一看
 * 就不对，而且比例不对」。以及 2026-09-12 Agent 自述的「镜头语言规则用了、视觉锚引用没用上」。
 *
 * ── 要权衡的那一个东西（D6 ②）──
 *
 * 另一条路是「不注入正文，让模型自己用 `read` 去读」——`<available_skills>` 索引已经这么做了
 * （`laneSkillIndex.mts`，pi / Anthropic 的标准答案）。但那条路管的是**模型自己发现**技能；
 * 用户**亲手点了**一条技能是另一件事：让它再自己决定要不要去读，就是把一次明确的用户意图
 * 降级成一个建议。所以两条并存且分工明确：索引管发现，这里管「用户点了的那一条」。
 *
 * ── 为什么只有一个注入点 ──
 *
 * 数门（`node scripts/door-map.mjs resolveRequestedSkill`）当时是 3 扇：`laneDesktopRuntime`
 * 的 singleShot 与 configure 各自内联拼一次，第三扇是本文件里一个**零生产调用者**的
 * `buildSkillSystemPrompt`——它带着交代文案，而活着的那两扇没有。一份带交代的实现躺在旁边、
 * 生产上跑的是没交代的那份，正是 P1 说的并行版。现在正文只在这里生成一次，那个旧的已删。
 */
export function buildSelectedSkillPrompt(skill: SkillRecord): string {
  // frontmatter 不进提示词：它是打包清单（license / source / preview / 双语 label），不是方法。
  // 实测 `curated-film-storyboard` 原文 1724 字里只有 305 字是方法——82% 的注入预算花在了元数据上。
  // **这不是 Nomi 的发明**：pi 自己展开 `/skill:<name>` 时就是 `stripFrontmatter(content).trim()`
  // （`pi-coding-agent/dist/core/agent-session.js:994`）。我们只是此前没走它那条路。
  const method = skillMarkdownWithoutFrontmatter(skill.body);
  // 信封逐字照 pi 的 `_expandSkillCommand`（同文件 :995）：`<skill name= location=>` +
  // 「References are relative to …」+ 正文。R31：别人已经定了形状就不要自己再造一个——
  // 这个形状还顺带把「技能目录里的相对路径指哪」说清楚了，而我们自己那版没有。
  const envelope = `<skill name="${skill.name}" location="${skill.filePath}">\n`
    + `References are relative to ${path.dirname(skill.filePath)}.\n\n${method}\n</skill>`;
  return [
    "本轮用户在输入框里挂了一条技能。它不是背景资料，是这一轮的作业规范：",
    "- 照它的方法和约束做这一轮；与你自己的一般习惯冲突时以它为准。",
    "- 它规定的画幅、时长、镜头数、生成模式这类**参数**，要真的写进你调用工具时的入参里；只在正文里说一句「用宽屏」不算照做。",
    "- 回复里要让用户看得出它被用了：用一句话说清你照它做了哪一两条关键决定。不要复述整份技能。",
    "- 它提到的外部 CLI、HTTP 或文件工具不会自动执行，除非当前对话确实提供了对应能力。",
    "",
    envelope,
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
