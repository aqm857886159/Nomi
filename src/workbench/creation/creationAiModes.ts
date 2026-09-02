import type { WorkbenchDocument } from '../workbenchTypes'
import i18n from '../../i18n'
import { ASSET_MASTER_PROMPT } from './assetMasterPrompt'
import { ASSET_MASTER_PROMPT_EN } from './assetMasterPrompt.en'
import {
  getCustomSystemPrompts,
  getSystemPromptOverrides,
  readOverride,
  resolveEffectivePrompt,
} from './systemPromptOverrides'
import type { CustomSystemPrompt } from '../../../electron/settings/systemPromptsContract'

export type CreationAiModeId =
  | 'general'
  | 'story'
  | 'script'
  | 'assets'
  | 'storyboard'
  | 'seedance'
  | 'review'

export type CreationAiMode = {
  /**
   * 内置的是 CreationAiModeId 那 7 个字面量；自定义的是运行时生成的 `custom:<uuid>`。
   * 所以这里是 string 而不是联合类型——自定义 id 是**数据**，不该进类型联合。
   * 「内置清单和设置契约的 id 不许漂移」由 creationAiModes.test.ts 的对拍测试保证。
   */
  id: string
  label: string
  shortLabel: string
  title: string
  description: string
  /**
   * 仅本模式的「专长层」：当前任务是什么 + 领域格式/方法论。
   * 身份「我是谁」、产品/流程认知、输出铁律、语言规则由后端共享的 NOMI_AGENT_IDENTITY
   * 统一注入（单一真相源），各模式不再各自声明「你是 X 助手」。
   */
  prompt: string
  /**
   * 同一条专长层的英文正文。**中文那份是档案源值、永不随语言变**（`prompt` 字段），
   * 英文界面下由 builtinPromptFor() 换成这一份。
   *
   * 为什么正文也要翻（2026-08-02 用户拍板，见 docs/plan/2026-09-02-english-system-prompts.md）：
   * 设置→AI 那个编辑框是**邀请用户改**的（可编辑/可覆盖/可重置/可自建），模式名早就翻了、
   * 正文没翻，于是英文用户面对一个「请你来定制」的框、里面是他读不懂更不敢动的中文——
   * 这个功能对他等于关闭。
   *
   * 缺省（undefined）时退回中文正文：这不是 fallback 逃生口，而是「这条还没出英文版」的
   * 诚实表达；7 个内置模式必须全部有值，由 creationAiModes.test.ts 钉死。
   */
  promptEn?: string
  /** 纯问答模式：不套创作任务框定、不注入 documentTools 写文档协议。 */
  chatOnly?: boolean
  /**
   * 专职模式：用户已经明确选了这条路（素材规划/文字稿/提示词/审校），本轮**不许**被
   * 跨面板意图路由劫走。自由写作的模式（通用/故事/剧本）才留着路由，因为那里「拆镜头」
   * 确实是个真实的跨面板跳转意图。
   */
  dedicatedJob?: boolean
  /** 用户自建的（不是内置 7 个之一）：没有「恢复默认」，改的是改名/删除。 */
  custom?: boolean
}

export const CREATION_AI_MODES: CreationAiMode[] = [
  {
    id: 'general',
    label: '通用问答',
    shortLabel: '通用',
    title: '通用助手',
    description: '像普通 AI 一样直接回答，不强制套创作模板、不写入文稿。',
    prompt: '本轮是通用问答：直接、简洁地回答用户的问题或请求。不要强行套用任何创作模板，也不要主动改写文稿。',
    promptEn:
      'This turn is open Q&A: answer the user’s question or request directly and concisely. Do not force any creative template onto it, and do not rewrite the document unprompted.',
    chatOnly: true,
  },
  {
    id: 'story',
    label: '写故事',
    shortLabel: '故事',
    title: '故事开发',
    description: '从主题、片段或选区扩展为可拍的故事梗概。',
    prompt: [
      '本轮任务：故事开发。基于用户输入、当前文稿和选区，产出可继续制作的视频故事方案。',
      '输出包括：核心梗、故事梗概、主角画像、核心冲突、情绪曲线、一句话卖点。',
    ].join('\n'),
    promptEn: [
      'This turn: story development. Using the user input, the current document and any selection, produce a video story plan that can be taken into production.',
      'Deliver: core hook, story synopsis, protagonist profile, central conflict, emotional arc, and a one-line pitch.',
    ].join('\n'),
  },
  {
    id: 'script',
    label: '写剧本',
    shortLabel: '剧本',
    title: '剧本创作',
    description: '按镜头、对白、OS/VO 和字幕格式生成剧本。',
    prompt: [
      '本轮任务：剧本创作。把材料改写成标准剧本。',
      '剧本正文必须使用镜头格式：每个镜头以“△ ”开头，包含景别、运镜、光线、氛围、动作和声音。',
      '对白使用“角色名（情绪/OS/VO）：内容”。需要字幕时使用“【字幕：xxx】”。',
      '输出优先给可直接粘贴进创作区的剧本正文。',
    ].join('\n'),
    // “△ ”与“【字幕：xxx】”是**格式标记**，创作区按它们解析，故英文版保留同样的标记形状，
    // 只把标记里的字换成英文（Subtitle）。改标记本身会让已有文稿解析不出来。
    promptEn: [
      'This turn: screenwriting. Rewrite the material into a standard screenplay.',
      'The screenplay body must use shot format: begin every shot with “△ ”, and cover shot size, camera movement, lighting, mood, action and sound.',
      'Write dialogue as “CharacterName (emotion/OS/VO): line”. When a subtitle is needed, use “【Subtitle: xxx】”.',
      'Prioritise returning screenplay body text that can be pasted straight into the editor.',
    ].join('\n'),
  },
  {
    id: 'assets',
    label: '素材规划',
    shortLabel: '素材',
    title: '角色/场景/道具',
    description: '拆出角色、场景、道具，并生成生图提示词。',
    // 领域规范住 assetMasterPrompt.ts（全资产大师 V3.0，用户 2026-08-12 提供）：
    // 场景七层递进 / 角色概念表 / 道具小资产卡，各带必填字段与自检清单。
    prompt: ASSET_MASTER_PROMPT,
    promptEn: ASSET_MASTER_PROMPT_EN,
    dedicatedJob: true,
  },
  {
    // 名字要和「拆成镜头·落画布」区分开：这个模式只在文稿里写文字稿，不落画布、不生成。
    // 旧名「写分镜/分镜」和画布的「分镜」撞车，用户误选它以为能拆镜头到画布（名实不符）→ 改叫「文字稿」。
    id: 'storyboard',
    label: '写分镜文字稿',
    shortLabel: '文字稿',
    title: '分镜文字稿',
    description: '在文稿里起草文字版分镜稿（15 秒一集，纯文字、不落画布）。想把故事结构化拆成镜头、落到画布生成，直接说「拆成镜头」或用浮现的卡片。',
    prompt: [
      '本轮任务：分镜脚本。把当前故事或剧本拆成可生成视频的分镜脚本。',
      '每集包含：素材上传清单、Seedance Prompt、尾帧描述。',
      '15秒分镜按 0-3秒、3-6秒、6-9秒、9-12秒、12-15秒 拆分。',
      '每段写清楚主体、动作、镜头运动、情绪、光线、转场和声音。',
    ].join('\n'),
    promptEn: [
      'This turn: shot list. Break the current story or screenplay into a shot list that can drive video generation.',
      'Each episode covers: asset upload checklist, Seedance prompt, and end-frame description.',
      'Split a 15-second episode into 0-3s, 3-6s, 6-9s, 9-12s and 12-15s.',
      'For each segment state the subject, action, camera movement, mood, lighting, transition and sound.',
    ].join('\n'),
    dedicatedJob: true,
  },
  {
    id: 'seedance',
    label: '提示词',
    shortLabel: '提示词',
    title: 'Seedance 提示词',
    description: '生成可复制到 Seedance 2.0 的最终提示词。',
    prompt: [
      '本轮任务：Seedance 2.0 提示词。输出可直接用于视频生成的时间轴提示词。',
      '格式：风格描述、15秒、画幅、整体氛围；然后按 0-3秒/3-6秒/6-9秒/9-12秒/12-15秒写画面。',
      '使用明确运镜词：推镜头、拉镜头、摇镜头、移镜头、跟镜头、环绕镜头、升降镜头、希区柯克变焦、一镜到底、手持晃动。',
      '如果是续集，保留“将@视频1延长15s”的开头，并说明 @图片/@视频 引用用途。',
      '避免过长堆砌，优先清晰可执行。',
    ].join('\n'),
    // ⚠️ 这条和 assets 一样属于「产物也英文」的高风险项，A/B 验收必须覆盖它（见 docs/plan）：
    // 运镜词是喂给 Seedance 的**受控词表**，「将@视频1延长15s」更是续集的固定起手式。
    // Seedance 是中文调优模型，换成英文词表/起手式有可能不被识别——实测不行就退回中文词表。
    promptEn: [
      'This turn: Seedance 2.0 prompt. Output a timeline prompt that can be used directly for video generation.',
      'Format: style description, 15 seconds, aspect ratio, overall mood; then describe the frame for 0-3s / 3-6s / 6-9s / 9-12s / 12-15s.',
      'Use explicit camera-move terms: push in, pull out, pan, track, follow, orbit, crane up/down, dolly zoom, one-take, handheld shake.',
      'For a sequel, keep the opening “Extend @video1 by 15s” and state what each @image/@video reference is used for.',
      'Avoid bloated stacking; prefer clear and executable.',
    ].join('\n'),
    dedicatedJob: true,
  },
  {
    id: 'review',
    label: '审校优化',
    shortLabel: '审校',
    title: '连续性审校',
    description: '检查资产引用、时间轴、情绪弧和敏感风险。',
    prompt: [
      '本轮任务：连续性审校。检查当前文稿的问题并给出可直接修改的结果。',
      '重点检查：资产引用是否对应、15秒时间轴是否完整、剧集尾帧和下一集开场是否连续、镜头语言是否具体、情绪弧是否成立、提示词是否过长或可能触发敏感风险。',
      '先列问题，再给修订版。不要输出泛泛建议。',
    ].join('\n'),
    promptEn: [
      'This turn: continuity review. Find the problems in the current document and return results that can be applied directly.',
      'Focus on: whether asset references line up, whether the 15-second timeline is complete, whether each episode’s end frame connects to the next episode’s opening, whether the camera language is concrete, whether the emotional arc holds, and whether any prompt is over-long or likely to trip content-safety filters.',
      'List the problems first, then give the revised version. Do not output vague advice.',
    ].join('\n'),
    dedicatedJob: true,
  },
]

/**
 * 内置模式在**当前界面语言**下的默认正文。
 *
 * 为什么解析落在这一处：全仓读 `mode.prompt` 的只有三个出口——defaultCreationAiPrompt、
 * listCreationAiModes、getCreationAiMode——它们都经过这里，于是「一处生效、处处生效」，
 * 不会出现某个出口还在发中文而另一个已经发英文（P1 不留并行读方）。
 *
 * 必须**同步**：getCreationAiMode() 在渲染期被调用（CreationAiPanel.tsx:133），
 * i18n.resolvedLanguage 是同步的，与 translateModelDisplayText 同构。
 * `|| ''` 是给测试环境兜底：单测里 i18n 可能没初始化，两个字段都 undefined 时不能让它抛。
 */
function builtinPromptFor(mode: CreationAiMode): string {
  const language = i18n.resolvedLanguage || i18n.language || ''
  return language.startsWith('en') && mode.promptEn ? mode.promptEn : mode.prompt
}

/** 内置默认提示词（不含用户覆盖）——「恢复默认」和「是否已自定义」的比对基准。 */
export function defaultCreationAiPrompt(modeId: unknown): string | undefined {
  const mode = CREATION_AI_MODES.find((item) => item.id === modeId)
  return mode ? builtinPromptFor(mode) : undefined
}

/**
 * 取模式定义，并把用户在设置里改过的系统提示词**盖在 prompt 上**。
 *
 * 为什么覆盖发生在这里而不是各调用点：这是全仓拿模式的唯一入口（渲染期的 activeMode、
 * 发送路径的 buildCreationAiPrompt、popover 的 autoPrompt 全都经过它），盖在这一层
 * 等于「一处生效、处处生效」，不会漏掉某个调用点拿到旧默认值（P2 修根因）。
 * 覆盖值来自模块级同步快照（systemPromptOverrides.ts），所以本函数仍是同步的。
 */
/**
 * 用户自建的提示词长成一个 CreationAiMode，和内置的平起平坐（用户 2026-08-18 拍板）。
 *
 * 两条能力声明是**定死的**，不给用户多一个开关（他要的是「存一段提示词」，不是配权限）：
 *  · chatOnly 不设 → 能写文稿，仍走既有待批卡确认；
 *  · dedicatedJob: true → 他明确选了这条路，不被拆分镜意图路由劫走（承接 08-17 D 项）。
 */
function customToMode(custom: CustomSystemPrompt): CreationAiMode {
  return {
    id: custom.id,
    label: custom.name,
    shortLabel: custom.name,
    title: custom.name,
    description: '',
    prompt: custom.prompt,
    dedicatedJob: true,
    custom: true,
  }
}

/**
 * 「本轮能选哪些提示词」的**唯一真相源**：内置 7 个（已盖上用户覆盖）+ 用户自建 N 个。
 *
 * 根因备忘（2026-08-18）：选择器过去手写条目、还把模式名硬编码成 `onModeChange('assets')`，
 * 于是 7 个内置模式里有 5 个在 UI 上根本不存在——提示词写了、设置里能编辑、就是调不起来。
 * 改成所有选择面都从这里 derive 之后，新增模式自动出现在列表里，不会再有「搁浅的模式」。
 * 结构测试钉死这条（见 creationAiModes.test.ts）。
 */
export function listCreationAiModes(): CreationAiMode[] {
  const overrides = getSystemPromptOverrides()
  const builtin = CREATION_AI_MODES.map((mode) => {
    const prompt = resolveEffectivePrompt(builtinPromptFor(mode), readOverride(overrides, mode.id))
    return prompt === mode.prompt ? mode : { ...mode, prompt }
  })
  return [...builtin, ...getCustomSystemPrompts().map(customToMode)]
}

/**
 * 取模式定义，并把用户在设置里改过的系统提示词盖在 prompt 上。自定义 id 也认。
 * 认不出的 id（比如选中的自定义提示词刚被删掉）→ 回退第一个内置模式，绝不返回空提示词。
 */
export function getCreationAiMode(modeId: unknown): CreationAiMode {
  const custom = getCustomSystemPrompts().find((item) => item.id === modeId)
  if (custom) return customToMode(custom)
  const mode = CREATION_AI_MODES.find((item) => item.id === modeId) || CREATION_AI_MODES[0]
  const override = readOverride(getSystemPromptOverrides(), mode.id)
  const prompt = resolveEffectivePrompt(builtinPromptFor(mode), override)
  return prompt === mode.prompt ? mode : { ...mode, prompt }
}

/**
 * 能力声明驱动能力执行（P4）：chatOnly 模式是纯问答，不接受任何写文档工具。
 * 这是「本模式能不能写文档」的单一判定源——UI 的写卡渲染/工具受理都查它，
 * 不再只靠 prompt 文字软约束（软约束挡不住模型仍发 insert/replace/append）。
 */
export function modeAllowsWriteTools(mode: CreationAiMode): boolean {
  return !mode.chatOnly
}

/**
 * 「本轮能不能被跨面板意图路由劫走」的单一判定源（同 modeAllowsWriteTools 的能力声明范式）。
 *
 * 根因备忘（2026-08-17）：旧写法把模式名硬编码成 `activeMode.id === 'storyboard'`，
 * 于是「素材规划」这种同样是用户明确选择的专职模式漏在守卫外——用户选了素材规划、
 * 说一句带「画面/镜头/场景」的话，就被 routeCreationIntent 劫持去拆分镜。
 * 改成读模式自己的能力声明后，新增专职模式只要打 dedicatedJob 就自动受保护，不会再漏。
 */
export function modeAllowsIntentRouting(mode: CreationAiMode): boolean {
  return !mode.dedicatedJob
}

export function extractWorkbenchDocumentText(document: WorkbenchDocument | null | undefined): string {
  return extractTextFromTiptapNode(document?.contentJson).trim()
}

function extractTextFromTiptapNode(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const record = node as { text?: unknown; content?: unknown }
  const ownText = typeof record.text === 'string' ? record.text : ''
  const children = Array.isArray(record.content)
    ? record.content.map(extractTextFromTiptapNode).filter(Boolean).join('\n')
    : ''
  return [ownText, children].filter(Boolean).join(ownText && children ? '\n' : '')
}

export function buildCreationAiPrompt(input: {
  mode: CreationAiMode
  userRequest: string
}): string {
  const request = input.userRequest.trim()
  // 通用问答：纯聊天，不写文档；文稿/选区如有需要由模型用 read_* 工具自取。
  if (input.mode.chatOnly) {
    return [
      input.mode.prompt,
      '',
      '需要时可调用 read_full_text 读取当前文稿、read_selection 读取选区作为上下文；本模式不要改写文档。',
      '',
      '用户问题：',
      request || '（用户未输入文字，请礼貌询问需要什么帮助）',
    ].join('\n')
  }
  return [
    input.mode.prompt,
    '',
    '工具使用规则（真实工具调用，用户会在卡片上确认每一次写入）：',
    '- 读取上下文：需要现有正文时调用 read_full_text；只针对选中片段操作时调用 read_selection。不要假设你已经知道文稿内容，先读再写。',
    '- 写入文档：改写/润色选中片段用 replace_selection；在光标处续写或补充用 insert_at_cursor；交付完整结果追加到文末用 append_to_end。',
    '- 写入工具的 content 字段只放最终正文，不要写使用说明或解释。',
    '- 只有用户明确要求写入/插入/替换/追加时才调用写入工具；否则用自然语言回答即可。',
    '',
    '当前任务：',
    request || `请按“${input.mode.label}”模式处理当前材料。`,
  ].join('\n')
}
