/**
 * 接模型的两个 App 级能力（方案 §4.1：一个工具 = 一种后果 = 动哪个状态 × 效果类别）。
 *
 * ── 为什么是两个而不是一个 ────────────────────────────────────────────────────────
 * 「连上一家 / 交一张卡 / 显示隐藏模型 / 取消」全是**可撤、本地、不花钱**的一格，合成一个工具；
 * 「永久删掉一条连接或几个模型」是另一格（irreversible），跨格必拆——合进去等于让一次「接模型」
 * 的调用和一次「删掉它」的调用在宿主的审批面上长得一样。
 *
 * ── 为什么是 App 级 ──────────────────────────────────────────────────────────────
 * 模型目录不住在任何一个项目里。硬要一个 `leaseHandle` 等于要求「先开个项目才能接模型」，
 * 而那正是 09-15 真机四轮零产出路上的闸之一（`CapabilityContract.scope`）。
 *
 * ── 地址不在入参里 ───────────────────────────────────────────────────────────────
 * `suggestedBaseUrl` 是**建议**：它只进贴 key 页的展示，永不落 vendor。密钥去向由用户在那一页
 * 按下保存时绑定（§6.1，`catalog/credentialBinding.ts`），`check:credential-origin` 盯着这张 schema。
 */
import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

/** 一张声明卡最大 512KB（与旧 `proposal.adapterDraft` 同一上限，传输层用字符串承载）。 */
const MAX_DECLARATION_TEXT = 512 * 1024;

const setupIdField = z.string().trim().min(1).max(200)
  .describe("The setup handle returned by connect_provider; nomi_read target=setup reports its state.");

/**
 * 同一个对外工具里同名字段必须**同形**（`projectMcpTool` 的 mergeFieldSchema 装配期抛）——
 * 那条规则不是审美：两个动词对同一个字段各写一份描述，模型读到的就是两种说法。
 */
const vendorKeyField = z.string().trim().min(1).max(160)
  .describe("Connection id, exactly as nomi_read target=models returned it.");

/** 同名同形（`mergeFieldSchema` 装配期抛）：两个动作各写一份描述 = 模型读到两种说法。 */
const providerNameField = z.string().trim().min(1).max(240)
  .describe("Provider display name. Required when connecting a new provider; on a declaration it names the connection the card creates.");

/**
 * 每个 action 模型要填的那一部分（**带描述**）。
 *
 * 动词声明（`verbs/onboardingVerbs.ts`）与契约的 `inputSchema` 都从这里派生——以前两边各写一遍
 * 同样的字段与约束（Ponytail 2026-09-18），那正是「同一件事两份定义」：其中一份改了约束，
 * 另一份不会红，而模型读的是前者、运行时判的是后者。
 */
export const MODEL_SETUP_ACTION_FIELDS = {
  connect_provider: z.object({
    name: providerNameField.optional(),
    vendorKey: vendorKeyField.optional(),
    docs: z.string().max(65_536).optional().describe("API documentation: the text itself, or one http(s) URL per line."),
    suggestedBaseUrl: z.string().trim().min(1).max(2_000).optional().describe("Address suggestion. It is only pre-filled on the credential page; the user confirms it by saving, and Nomi binds the key to it."),
    proxyEnabled: z.boolean().optional().describe("Turn this connection's already-saved proxy on or off. The proxy URL itself is never an argument."),
    reissueKey: z.boolean().optional().describe("Reopen the credential page for an existing connection so the user can paste a new key."),
  }).strict(),
  submit_declaration: z.object({
    /**
     * **没有 `setupId`**，这是刻意的。
     *
     * 2026-09-21 之前它是必填的，而拿到它要先调 `connect_provider`、还要会话处在对的阶段——
     * 两个 AI 必须猜对的隐藏状态，实测 14 次调用里一半栽在这上面（K4：顺序错误被标成
     * `code:"schema"`，`nextAction` 还让 AI 去「修字段」，于是它死循环）。句柄证明不了
     * 它提高接入成功率，所以按用户 09-21 的裁决真删，不留旧形状并行。
     * 幂等由「整份覆盖」本身提供：同一张卡交两次，结果逐字节一样。
     */
    vendorKey: vendorKeyField.optional(),
    name: providerNameField.optional(),
    declaration: z.string().min(2).max(MAX_DECLARATION_TEXT).describe("The whole declaration card as JSON text, including its provider block. Its shape is the contractSchema returned by nomi_read target=onboarding_kit, which also carries worked examples."),
  }).strict(),
  /**
   * 密钥的**第二个入口**（09-21 用户拍板）：默认引导仍是用户自己在 Nomi 的贴 key 页粘，
   * 但用户可以选择把 key 交给自己的 AI 代填。两条路同一份存储、同一扇写门
   * （`catalogStore.applyApiKeyUpsert`）、同一套 origin 绑定——不是两套实现。
   *
   * 入参**只有 key 本身**：地址与「key 怎么放」那六个字段一律不上 schema
   * （`check:credential-origin` 规则 2）。「谁来敲这串字」不是安全不变量；
   * 「已存的 key 会不会在用户不知情时被发往新域名」才是，那条由绑定守着。
   */
  set_key: z.object({
    vendorKey: vendorKeyField,
    apiKey: z.string().min(1).max(4_096).describe("The API key exactly as the provider issued it. Only send a key the user handed you for this purpose; never ask for one, never print it back, never write it to a file."),
  }).strict(),
  show_models: z.object({
    vendorKey: vendorKeyField,
    modelKeys: z.array(z.string().trim().min(1).max(160)).min(1).max(200).describe("Exact model ids from nomi_read target=models."),
    visible: z.boolean().describe("true shows them in the pickers, false hides them."),
  }).strict(),
  cancel: z.object({ setupId: setupIdField }).strict(),
} as const;

/** 契约的语义输入：上面那几份 + 各自的 `action` 判别字段。 */
export const modelSetupInputSchema = z.discriminatedUnion("action", [
  MODEL_SETUP_ACTION_FIELDS.connect_provider.extend({ action: z.literal("connect_provider") }),
  MODEL_SETUP_ACTION_FIELDS.submit_declaration.extend({ action: z.literal("submit_declaration") }),
  MODEL_SETUP_ACTION_FIELDS.set_key.extend({ action: z.literal("set_key") }),
  MODEL_SETUP_ACTION_FIELDS.show_models.extend({ action: z.literal("show_models") }),
  MODEL_SETUP_ACTION_FIELDS.cancel.extend({ action: z.literal("cancel") }),
]);

/**
 * 试跑：**这个工具会花用户的钱**，所以它是自己一个能力，不是 `nomi_model_setup` 的第五个动作。
 *
 * 为什么必须拆出来：`model.onboarding.setup` 声明的是 `reversible_local`——一次接模型的调用
 * 和一次真实生成在宿主的审批面上会长得一样，而付费边界（`paidBoundary.ts`）的全部判据都
 * 挂在契约的 `effect:"paid"` 上。把一次真花钱的动作塞进那个契约里，不会有任何东西报错，
 * 只会在某个真实用户的账单上出现——那正是该文件开头记下的失败方式。
 *
 * 钱怎么把关：它走的是**手动画布那条执行器**（`runtime.runTask`），钱闸也是那一条
 * （`spendGrant` → 渲染层报价确认卡）。模型能调这个工具，但结不了这笔账——确认按钮在
 * 用户自己的 Nomi 窗口里。这与付费边界那句「宿主看得见、永远批不动」是同一个意思。
 */
export const modelTryInputSchema = z.object({
  newAttemptOf: z.string().trim().min(1).max(160).optional().describe("Only after the user explicitly requests a NEW order: current attemptId from the original submission receipt. Always requires confirmation in Nomi, even in full-auto. Omit to observe or safely retry the original intent; changing parameters never opens a new order."),
  vendorKey: vendorKeyField,
  modelKey: z.string().trim().min(1).max(256).describe("Exact model id, as nomi_read target=models or your own submitted card spells it."),
  prompt: z.string().trim().min(1).max(4_000).optional().describe("Prompt for the one test generation; a short neutral prompt is used when omitted."),
  taskKind: z.string().trim().min(1).max(64).optional().describe("Which declared mode to exercise, for example text_to_image. The model's first declared mode is used when omitted."),
  // 2026-09-21：这里原本是 `z.record(z.string(), z.unknown())`，广播出去是
  // `{"type":"object","additionalProperties":{}}` —— 键名不可枚举是真话（参数名由卡自己声明），
  // 但「值随便什么都行」不是：执行侧只认标量。`check:model-schema` 就是冲这条来的，
  // 而这一族的失败本地看不见——编译过、单测过、广播得出去，只有真模型会用一次失败告诉你。
  // 值的类型用与画布写入同一族的那一份（`canvasWrite.ts` 的 `canvasNodeMetaValueSchema` 同一个 union），
  // 不另造第二种「参数值」的说法。
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
    .describe("Parameter values for this run: the keys the card declared, each a string, number or boolean."),
}).strict();

export const modelRemoveInputSchema = z.object({
  vendorKey: vendorKeyField,
  modelKeys: z.array(z.string().trim().min(1).max(160)).min(1).max(200).optional()
    .describe("Exact model ids to delete. Omit to delete the whole connection and its saved key."),
  ifUnchanged: z.string().trim().min(1).max(200)
    .describe("Fingerprint from the nomi_read that listed these; the delete is refused if anything changed since."),
}).strict();

export type ModelSetupInput = z.infer<typeof modelSetupInputSchema>;
export type ModelTryInput = z.infer<typeof modelTryInputSchema>;
export type ModelRemoveInput = z.infer<typeof modelRemoveInputSchema>;

export const MODEL_ONBOARDING_SETUP_CAPABILITY = {
  id: "model.onboarding.setup",
  version: 1,
  aliases: { pi: "connect_model_provider", mcp: "nomi_model_setup" },
  inputSchema: modelSetupInputSchema,
  // 结果形状由信封（`capabilityCore/modelOnboarding/envelope.ts`）说了算，契约这一层不再复述一遍。
  outputSchema: z.unknown(),
  effect: "reversible_write",
  effectClass: "reversible_local",
  execution: { port: "model-catalog", availability: "main_or_renderer" },
  exposure: "mcp_safe",
  requiredScope: "models:write",
  targetKind: "app",
  scope: "app",
} as const satisfies CapabilityContract<ModelSetupInput, unknown>;

export const MODEL_ONBOARDING_REMOVE_CAPABILITY = {
  id: "model.onboarding.remove",
  version: 1,
  aliases: { pi: "remove_model_provider", mcp: "nomi_remove_provider" },
  inputSchema: modelRemoveInputSchema,
  outputSchema: z.unknown(),
  effect: "destructive",
  effectClass: "irreversible",
  execution: { port: "model-catalog", availability: "main_or_renderer" },
  exposure: "mcp_safe",
  requiredScope: "models:write",
  targetKind: "app",
  scope: "app",
} as const satisfies CapabilityContract<ModelRemoveInput, unknown>;

export const MODEL_ONBOARDING_TRY_CAPABILITY = {
  id: "model.onboarding.try",
  version: 1,
  // 别名两个面都声明，但**内部面不会投影它**：付费能力一律不投（`projectsToInternalProfile`），
  // 注册表在装配期把这条当断言用。`pi` 这一格仍要写，因为付费边界的名单是从别名算出来的——
  // 动词叫 `try_model`，它必须能在名单里被认出来，否则「动词声明 spend 而契约没声明 paid」
  // 这条装配期对账（A1）就落空了。
  aliases: { pi: "try_model", mcp: "nomi_try_model" },
  inputSchema: modelTryInputSchema,
  outputSchema: z.unknown(),
  effect: "paid",
  effectClass: "spend",
  execution: { port: "model-catalog", availability: "main_only" },
  exposure: "mcp_safe",
  requiredScope: "models:write",
  targetKind: "app",
  scope: "app",
} as const satisfies CapabilityContract<ModelTryInput, unknown>;
