// 接模型这条路的工具面 · **单一声明**（描述 / schema / 运行时必填 / 题库 / 门岗五处都从这里派生）。
//
// 设计正本：docs/design/2026-09-11-mcp-onboarding-tool-face.md（9 动词版）
// 形态：用户 2026-09-11 22:10 拍板折算成 **4 个工具**。调和规则（Anthropic「合并相关操作」×
// 达芬奇「枚举让审批注解塌到整组」）：
//
//     一个工具 = 一种后果 = 动哪个状态 × 效果类别；**同格合并用 action，跨格必拆**。
//
// 于是 6 个「改设置会话 + 可撤销 + 不花钱」的步骤合成 nomi_model_setup(action=…)，
// 读 / 等 / 不可逆删除各自单开。check:tool-face 的「同格多工具」「跨格合并」两条把这条规则钉成门岗。
//
// TODO(single-owner)：`feat/agent-tool-face-single-owner-20260911` 把全站三个注册表收成一份
// VerbDeclaration[] 之后，本文件的 ONBOARDING_VERBS 直接并进那份声明（形状已按它写），
// tools.ts 的派生函数换成那边的公共派生器，此处只留数据。
import type { JsonSchemaObject } from '../../shared/agentCapabilities/modelVisibleJsonSchema'

/** 效果类别（第一性原理 §1 四值）。本域**没有 spend**——09-11 拍板：自检免费（门岗 O1）。 */
export type OnboardingEffect = 'read' | 'reversible_local' | 'irreversible'

/** 用户接下来看到什么。`userSees` 的措辞由 dispatch 层按同一份表给。 */
export type OnboardingNextActionKind =
  | 'none' | 'user_sees_key_page' | 'user_sees_confirm_card' | 'waiting_for_user' | 'working'

/** 状态编号挂在既有 S11「模型接入」下做细分，不新起词表（R14.1）。 */
export type OnboardingStateId = 'S11.0' | 'S11.1' | 'S11.2' | 'S11.3' | 'S11.4' | 'S11.5' | 'S11.6'

/** Anthropic 五槽描述；第五槽 consequence 不手写，由 effect × nextAction 派生（见下表）。 */
export type VerbDescription = {
  /** 做什么 */ does: string
  /** 何时用 */ useWhen: string
  /** 何时不用 + 该用谁 */ notWhen: string
  /** 参数从哪来 */ params: string
  /** 明说不做什么（可选，本域用于「不许带 key」「异步必须声明 query」这类硬话） */ doesNot?: string
}

export type VerbDeclaration = {
  /** 对外工具名（外部面机械加 nomi_ 前缀；内部面不带）。 */
  tool: string
  /** 同格合并时的 action 值；独立工具为 null。 */
  action: string | null
  effect: OnboardingEffect
  /** 动哪些状态。(states 的效果格) × effect 决定它属于哪个工具——门岗按这两列判。 */
  states: readonly OnboardingStateId[]
  describe: VerbDescription
  /** 这个动作特有的 schema 字段。工具 schema = 本工具全部 action 字段的并集。 */
  fields: Readonly<Record<string, JsonSchemaObject>>
  /** schema 的 required 就是运行时校验的 required（门岗 O4：不许存在第二张表）。 */
  required: readonly string[]
  /** 条件必填：仅当 when 成立时才追加（扁平 schema + 描述里说真话，见下方注释）。 */
  conditionalRequired?: { when: (args: Record<string, unknown>) => boolean; whenText: string; fields: readonly string[] }
  /** 这一跳可能返回的 nextAction.kind（派生 consequence 用）。 */
  nextActionKinds: readonly OnboardingNextActionKind[]
  /** 内部路由键。 */
  method: string
  /** 每条都必须过自己的 schema（T11，由测试钉住）。 */
  inputExamples: readonly Record<string, unknown>[]
}

// ── 第五槽：consequence 由 effect × nextAction 派生 ─────────────────────────────────────────
// 手写第五槽 = 同一句话抄 N 遍、改一处漏 N-1 处（第一性原理 §6.1）。这张表是它唯一的 owner。
// 措辞硬约束（门岗 O5）：只要这个动作的 unverified 可能含 model_produces_output，
// 文本里就不许出现 connected / verified / ready to use。
const CONSEQUENCE_BY_EFFECT: Record<OnboardingEffect, string> = {
  read: 'Nothing changes, nothing is charged.',
  reversible_local: 'Nothing is charged; the change is local and can be undone.',
  irreversible: 'This permanently deletes records, including any stored key.',
}
const CONSEQUENCE_BY_NEXT_ACTION: Record<OnboardingNextActionKind, string> = {
  none: 'The result is final for this step.',
  user_sees_key_page: 'Nomi opens its own local key page and asks the user for the key; the setup is NOT finished — wait with nomi_await_setup.',
  user_sees_confirm_card: 'The user always sees a confirmation card first, in every approval mode; nothing happens until they accept and this call returns before that.',
  waiting_for_user: 'Someone must act in Nomi before this moves; wait with nomi_await_setup rather than repeating a write.',
  working: 'Nomi is still working; wait with nomi_await_setup rather than repeating a write.',
}

/** 第五槽全文（派生，不手写）。 */
export function consequenceText(verb: VerbDeclaration): string {
  const kinds = verb.nextActionKinds.filter((kind) => kind !== 'none')
  const tail = kinds.length ? kinds.map((kind) => CONSEQUENCE_BY_NEXT_ACTION[kind]).join(' ') : CONSEQUENCE_BY_NEXT_ACTION.none
  return `${CONSEQUENCE_BY_EFFECT[verb.effect]} ${tail}`
}

/** 五槽拼成模型读的那份描述（英文——T5 语言统一）。 */
export function renderDescription(verb: VerbDeclaration): string {
  const parts = [
    verb.describe.does,
    `Use it when: ${verb.describe.useWhen}`,
    `Do not use it when: ${verb.describe.notWhen}`,
    `Parameters: ${verb.describe.params}`,
  ]
  if (verb.describe.doesNot) parts.push(verb.describe.doesNot)
  parts.push(consequenceText(verb))
  return parts.join(' ')
}

// ── 共享字段 ────────────────────────────────────────────────────────────────────────────
// setupId 是唯一留给模型的句柄（MCP 2026-07-28 有状态工具指南：返回显式 handle、后续传回、
// 保留策略写进创建工具的描述）。**版本号和幂等键不在这里，也不在任何地方**——
// 宿主按 (setupId, action, canonicalJson(args) 的 SHA-256) 自己派生（门岗 O3）。
const SETUP_ID: JsonSchemaObject = {
  type: 'string', minLength: 1, maxLength: 200,
  description: 'The setup handle returned by a previous call. Copy it verbatim; never construct one.',
}
const VENDOR_KEY: JsonSchemaObject = {
  type: 'string', minLength: 1, maxLength: 160,
  description: 'A connection id from list_models. Copy it verbatim.',
}
const MODEL_KIND: JsonSchemaObject = { type: 'string', enum: ['text', 'image', 'video', 'audio', 'model3d'] }

/** 一串 modelKey。同一个名字在 check_connection / show_models / remove_provider 里是同一个形状——
 *  一个字段名一个意思，模型不用记三套。 */
const MODEL_KEYS: JsonSchemaObject = {
  type: 'array', minItems: 1, maxItems: 200,
  items: { type: 'string', minLength: 1, maxLength: 160 },
  description: 'modelKey strings copied verbatim from nomi_list_models.',
}

// ── 4 个工具 · 9 个动作 ─────────────────────────────────────────────────────────────────
export const ONBOARDING_VERBS: readonly VerbDeclaration[] = Object.freeze<VerbDeclaration[]>([
  // ── 读（格：read） ─────────────────────────────────────────────────────────────────
  {
    tool: 'nomi_list_models',
    action: null,
    effect: 'read',
    states: ['S11.0', 'S11.1', 'S11.2', 'S11.3', 'S11.4', 'S11.5', 'S11.6'],
    describe: {
      does: 'Read the user\'s model settings as they see them: every provider connection (name, base URL, auth style, whether a key is stored), every model under it (modelKey, kind, price when known, last self-check, whether it is in the canvas model picker and why not when it is not), and any setup still in progress with the step it waits on. Main entry point of this group: the others are fed by it.',
      useWhen: 'Before every other call here — every vendorKey, modelKey and setupId comes from it. Also when the user asks what models they have, why one is missing from the picker, what a provider returned, or how far a setup got.',
      notWhen: 'Not for waiting — it returns whatever is true now; wait with nomi_await_setup. It answers "what has the user configured"; for "which models can I generate with now" (moduleId, reference slots) read nomi_read target=models.',
      params: 'All optional. No parameters returns everything, in-progress setups first.',
      doesNot: 'API keys are never returned in any form, only a status. Prices print only when known; unknown is never reported as 0.',
    },
    fields: { vendorKey: VENDOR_KEY, setupId: SETUP_ID, kind: MODEL_KIND },
    required: [],
    nextActionKinds: ['none'],
    method: 'modelSetup.list',
    inputExamples: [{}, { vendorKey: 'deepseek' }, { kind: 'video' }],
  },
  {
    tool: 'nomi_await_setup',
    action: null,
    effect: 'read',
    states: ['S11.0'],
    describe: {
      does: 'Block until a setup stops waiting on someone — the user finishes pasting a key, or discovery finishes — then return what nomi_list_models returns for it.',
      useWhen: 'Right after any call whose nextAction.kind is waiting_for_user or working, and when the user says they did their part ("I pasted the key").',
      notWhen: 'Never express waiting by repeating a write — that is safe but tells you nothing new. For the current state use nomi_list_models.',
      params: 'setupId comes from the call that started the wait. timeoutSeconds 1-300, default 60.',
      doesNot: 'A timeout is not a failure: nextAction.kind comes back unchanged — call again or tell the user what is pending.',
    },
    fields: {
      setupId: SETUP_ID,
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300, description: 'How long to block, 1-300 seconds. Default 60.' },
    },
    required: ['setupId'],
    nextActionKinds: ['none'],
    method: 'modelSetup.await',
    inputExamples: [{ setupId: 'stp_7Q2' }, { setupId: 'stp_7Q2', timeoutSeconds: 180 }],
  },

  // ── 改设置会话（格：reversible_local）—— 同格合并，action 枚举 ─────────────────────
  {
    tool: 'nomi_model_setup',
    action: 'connect_provider',
    effect: 'reversible_local',
    states: ['S11.1'],
    describe: {
      does: 'Create a provider connection, or change one that exists — name, base URL, auth style, the NAME (never the value) of the header or query parameter carrying the key, an optional proxy, and any API docs you have. Pass vendorKey to change; omit it to create.',
      useWhen: 'The user asks to connect a provider, a relay endpoint or a local ComfyUI; or to correct an address, auth style or name; or to replace a key (reissueKey).',
      notWhen: 'The only way to create or change a connection; there is no separate update. It does not choose models (choose_models) or check anything (check_connection). Omit baseUrl when you do not know it and call this anyway — never guess a domain, and never stop to ask for one: only kind + name are needed to create a connection, and Nomi asks the user on its own page for whatever is still missing.',
      params: 'docs is the most valuable input — paste the provider\'s real API documentation or newline-separated doc URLs; it is taken at face value. authHeader and authQueryParam carry only the NAME of the field. proxyEnabled turns an already-configured proxy on or off for this connection.',
      doesNot: 'Never put an API key, token, password or Authorization value in any parameter of any tool in this group — Nomi asks the user itself, on a local page you never see; if the user pastes a key into the chat, tell them to rotate it. When a key is stored Nomi probes the model list itself, so there is no discovery action to call. The setup handle lives 7 days and is listed by nomi_list_models until then.',
    },
    fields: {
      vendorKey: VENDOR_KEY,
      setupId: SETUP_ID,
      kind: { type: 'string', enum: ['http-api-provider', 'comfyui-workflow'] },
      name: { type: 'string', minLength: 1, maxLength: 240 },
      baseUrl: { type: 'string', maxLength: 2000 },
      docs: { type: 'string', maxLength: 65536, description: 'The provider\'s real API documentation, or newline-separated doc URLs.' },
      providerKind: { type: 'string', maxLength: 80 },
      authType: { type: 'string', enum: ['none', 'bearer', 'x-api-key', 'query'] },
      authHeader: { type: 'string', maxLength: 200, description: 'The NAME of the header that carries the key, never its value.' },
      authQueryParam: { type: 'string', maxLength: 200, description: 'The NAME of the query parameter that carries the key, never its value.' },
      proxyUrl: { type: 'string', maxLength: 2000 },
      proxyEnabled: { type: 'boolean', description: 'Route this connection through the secure proxy Nomi has configured for it. Only valid once a proxy exists.' },
      reissueKey: { type: 'boolean', description: 'Ask the user for a new key for an existing connection.' },
    },
    required: [],
    conditionalRequired: {
      when: (a) => typeof a.vendorKey !== 'string' && typeof a.setupId !== 'string',
      whenText: 'creating a new connection (no vendorKey and no setupId)',
      fields: ['kind', 'name'],
    },
    nextActionKinds: ['user_sees_key_page', 'working', 'none'],
    method: 'modelSetup.connect_provider',
    inputExamples: [
      { action: 'connect_provider', kind: 'http-api-provider', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', authType: 'bearer', authHeader: 'Authorization' },
      { action: 'connect_provider', vendorKey: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
      { action: 'connect_provider', vendorKey: 'deepseek', reissueKey: true },
    ],
  },
  {
    tool: 'nomi_model_setup',
    action: 'choose_models',
    effect: 'reversible_local',
    states: ['S11.3'],
    describe: {
      does: 'Choose which of a provider\'s models to onboard — from the candidates Nomi discovered, or by hand when the provider has no model-list endpoint.',
      useWhen: 'After nomi_list_models shows candidates, or when the user names the models they want ("only the two image ones").',
      notWhen: 'Not for hiding models (show_models) or deleting them (nomi_remove_provider). Never invent a modelKey — copy it from nomi_list_models or the provider\'s own docs.',
      params: 'setupId from nomi_list_models; models is 1-100 {modelKey, kind} entries.',
      doesNot: 'They appear under the connection at once, marked "not yet tried", but are not selectable on the canvas until you also call show_models.',
    },
    fields: {
      setupId: SETUP_ID,
      models: {
        type: 'array', minItems: 1, maxItems: 100,
        items: {
          type: 'object',
          properties: { modelKey: { type: 'string', minLength: 1, maxLength: 160 }, kind: MODEL_KIND },
          required: ['modelKey', 'kind'],
          additionalProperties: false,
        },
      },
    },
    required: ['setupId', 'models'],
    nextActionKinds: ['none'],
    method: 'modelSetup.choose_models',
    inputExamples: [{ action: 'choose_models', setupId: 'stp_7Q2', models: [{ modelKey: 'deepseek-chat', kind: 'text' }] }],
  },
  {
    tool: 'nomi_model_setup',
    action: 'draft_adapter',
    effect: 'reversible_local',
    states: ['S11.4'],
    describe: {
      does: 'Supply the request recipe — the JSON {"sources":[...],"models":[...]} saying which endpoint to call, what the body looks like, whether the job is sync or async, and how to read status back. For ComfyUI pass the workflow JSON instead.',
      useWhen: 'Only when a result reports compileRequest for this setup — this machine has no text model to read the docs, so the job falls to you.',
      notWhen: 'Never send an unrequested draft. Never restate provider identity, model ids, display names or billing kinds — Nomi owns those and rejects a draft that repeats them. Never write fields from memory: fetch the real docs and reconcile every path, field name, auth placement and polling shape.',
      params: 'adapterDraft is JSON text matching the contractSchema from compileRequest; or workflow for ComfyUI.',
      doesNot: 'Async providers must declare create plus query plus statusMapping; declaring an async endpoint as synchronous is the most common cause of a failed setup. The result says which field failed — fix it and send the whole draft again.',
    },
    fields: {
      setupId: SETUP_ID,
      adapterDraft: {
        type: 'string', minLength: 2, maxLength: 524288,
        description: 'JSON text of {"sources":[...],"models":[...]} compiled from the provider API docs.',
      },
      workflow: { type: 'string', minLength: 1, maxLength: 2097152, description: 'ComfyUI workflow JSON text.' },
    },
    required: ['setupId'],
    nextActionKinds: ['none'],
    method: 'modelSetup.draft_adapter',
    inputExamples: [{ action: 'draft_adapter', setupId: 'stp_7Q2', adapterDraft: '{"sources":[],"models":[]}' }],
  },
  {
    tool: 'nomi_model_setup',
    action: 'check_connection',
    effect: 'reversible_local',
    states: ['S11.5'],
    describe: {
      does: 'Run Nomi\'s FREE self-check: resolve the base URL, present the stored key, list the provider\'s models, confirm the chosen modelKeys are among them. Returns per-model rows with latency, plus the raw response excerpt on failure.',
      useWhen: 'After choose_models, and when the user asks whether a connection works or why it failed.',
      notWhen: 'This is not a test generation and proves nothing about output — only that the address resolves, the key is accepted and the model id exists. Never call it to estimate cost. The real first run is the user\'s own, from the "try it" button on the model page, which shows the price first.',
      params: 'Give vendorKey or setupId; modelKeys narrows; timeoutSeconds defaults to 15.',
      doesNot: 'Never call the result "verified" or "working" — say what it checked. Some providers reject a valid key on their model-list endpoint and some accept one that cannot generate, so a pass is evidence about the address and the key, not the model. A failure hides, unpublishes and deletes nothing: the models stay, labelled "not yet tried". unverified still contains model_produces_output, so do not say the setup is finished.',
    },
    fields: {
      vendorKey: VENDOR_KEY,
      setupId: SETUP_ID,
      modelKeys: MODEL_KEYS,
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 60, description: 'Per-probe timeout in seconds. Default 15.' },
    },
    required: [],
    conditionalRequired: {
      when: (a) => typeof a.vendorKey !== 'string' && typeof a.setupId !== 'string',
      whenText: 'you did not give setupId',
      fields: ['vendorKey'],
    },
    nextActionKinds: ['none'],
    method: 'modelSetup.check_connection',
    inputExamples: [
      { action: 'check_connection', vendorKey: 'deepseek' },
      { action: 'check_connection', setupId: 'stp_7Q2', modelKeys: ['deepseek-chat'] },
    ],
  },
  {
    tool: 'nomi_model_setup',
    action: 'show_models',
    effect: 'reversible_local',
    states: ['S11.6'],
    describe: {
      does: 'Show or hide models in the canvas model picker. Showing makes a model selectable; hiding removes it from the picker and deletes nothing.',
      useWhen: 'To finish a setup, and when the user says the picker has too many models, or asks to hide, remove from the list, or bring back a model.',
      notWhen: 'Hide and delete are different and the user almost always means hide — nomi_remove_provider only when they explicitly say delete. Never make showing conditional on a self-check passing: an unchecked model is shown with a "not yet tried" badge, deliberately.',
      params: 'vendorKey plus modelKeys copied verbatim from nomi_list_models; visible true to show, false to hide.',
      doesNot: 'Nothing is deleted. blastRadius.modelsAppearing and modelsDisappearing say how much the picker changed.',
    },
    fields: {
      vendorKey: VENDOR_KEY,
      modelKeys: MODEL_KEYS,
      visible: { type: 'boolean', description: 'true shows the models in the canvas picker, false hides them.' },
    },
    required: ['vendorKey', 'modelKeys', 'visible'],
    nextActionKinds: ['none'],
    method: 'modelSetup.show_models',
    inputExamples: [{ action: 'show_models', vendorKey: 'deepseek', modelKeys: ['deepseek-chat'], visible: true }],
  },
  {
    tool: 'nomi_model_setup',
    action: 'cancel',
    effect: 'reversible_local',
    states: ['S11.0'],
    describe: {
      does: 'Abandon an in-progress model setup.',
      useWhen: 'The user wants to start over, or the setup is stuck and you have already told them what the provider returned.',
      notWhen: 'It deletes nothing already saved — a stored connection and a pasted key both survive (nomi_remove_provider for those). Not a way to retry: retry by calling connect_provider again with the same vendorKey.',
      params: 'setupId from nomi_list_models.',
      doesNot: 'The setup disappears from nomi_list_models. Report the provider\'s original error code and text verbatim — never invent a reason.',
    },
    fields: { setupId: SETUP_ID },
    required: ['setupId'],
    nextActionKinds: ['none'],
    method: 'modelSetup.cancel',
    inputExamples: [{ action: 'cancel', setupId: 'stp_7Q2' }],
  },

  // ── 删（格：irreversible）—— 单独工具，锁只在这里 ─────────────────────────────────
  {
    tool: 'nomi_remove_provider',
    action: null,
    effect: 'irreversible',
    states: ['S11.6'],
    describe: {
      does: 'Permanently delete a provider connection, or single model records under it. Deleting a connection also deletes its stored key.',
      useWhen: 'Only when the user explicitly asks to delete a provider or a model record.',
      notWhen: 'Not for tidying the picker (show_models) or abandoning a setup (cancel). "I don\'t use these" means hide.',
      params: 'modelKeys deletes only some records instead of the whole connection. ifUnchanged is state.fingerprint from your most recent nomi_list_models — copy it VERBATIM, never construct or increment it.',
      doesNot: 'Deleted keys and connections cannot be restored. Nothing is deleted until the user accepts the confirmation card and this call returns before that — do not say it is deleted; wait with nomi_await_setup.',
    },
    fields: {
      vendorKey: VENDOR_KEY,
      modelKeys: MODEL_KEYS,
      ifUnchanged: {
        type: 'string', minLength: 1, maxLength: 200,
        description: 'An opaque string from the state.fingerprint of your most recent nomi_list_models. Copy it verbatim; it is not a number and must never be constructed or incremented.',
      },
    },
    required: ['vendorKey', 'ifUnchanged'],
    nextActionKinds: ['user_sees_confirm_card'],
    method: 'modelSetup.remove_provider',
    inputExamples: [{ vendorKey: 'deepseek', ifUnchanged: 'fp_3c9a1e' }],
  },
])

/** 工具名（发布顺序=读优先）。 */
export const ONBOARDING_TOOL_NAMES = Object.freeze(
  [...new Set(ONBOARDING_VERBS.map((verb) => verb.tool))],
)

/** action 值 → 声明（nomi_model_setup 的派发表）。 */
export const ONBOARDING_VERB_BY_ACTION: Readonly<Record<string, VerbDeclaration>> = Object.freeze(
  Object.fromEntries(ONBOARDING_VERBS.filter((verb) => verb.action).map((verb) => [verb.action as string, verb])),
)

/** 工具名 → 该工具的全部声明。 */
export function verbsOfTool(tool: string): readonly VerbDeclaration[] {
  return ONBOARDING_VERBS.filter((verb) => verb.tool === tool)
}

/** 这一跳用哪条声明（独立工具 = 唯一那条；合并工具 = 按 action）。 */
export function resolveVerb(tool: string, args: Record<string, unknown>): VerbDeclaration | undefined {
  const candidates = verbsOfTool(tool)
  if (candidates.length === 1 && candidates[0].action === null) return candidates[0]
  const action = typeof args.action === 'string' ? args.action : ''
  return candidates.find((verb) => verb.action === action)
}
