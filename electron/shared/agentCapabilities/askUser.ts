// 「问用户一句」这件事的**唯一形状**。全仓只有这一份。
//
// ── 它在解决哪个真实摩擦 ──
//
// 2026-09-21 实测（scratchpad/investigate-askback.md §3.3）：真实模型跑 16 句该反问的话，
// 反问卡触发 **0/16**。原因不是「触发条件太窄」，是**根本没有触发条件**——20 个动词里
// 没有一个能让模型问一句话。用户的原话是「这个是模型要自己输入选项吧，通用的吧，
// 别搞错了，只有那一种反问就离谱了」：要的是一个**通用**提问工具，模型自己写题目、
// 自己写选项，任何面任何话题都能问。
//
// ── 为什么这个文件必须是唯一的一份 ──
//
// 用户以前被同一个坑修过一次：一个工具的契约有好几份（schema / 描述 / 提示词里的用法 /
// MCP 目录 / 校验器 / 渲染层类型），每份不一样，于是 Agent 很难触发它
// （`docs/lessons/stale-directives-outlive-tool-renames.md`）。09-18 的根治
// （`4b43f3ac9`）把模型可见工具收成一条动词声明，schema / 描述 / 必填 / 注解全从它算出来。
// 提问工具是**全新**的模型可见工具，最容易再长出那个坑，所以这里把话说死：
//
//   · 模型看到的 JSON Schema        ← `askUserInputSchema`（经动词声明 → `toPublishedJsonSchema`）
//   · 主进程校验                     ← `askUserInputSchema`（`laneTools.mts` 的那一次 contract parse）
//   · 渲染层 `agentPanelV4Question` ← `z.infer<typeof askUserInputSchema>`（一行 re-export，不手写）
//   · 身份提示词里举的例子           ← 动词声明的 `examples`（装配期逐条喂回同一份 schema）
//   · 熔断转提问时构造的参数         ← `askUserPendingArgsSchema`（同一份 + 两个宿主字段）
//   · 渲染层版式（Approval Card）     ← 同一份：一张卡 1–3 题、一次显示一题、每题单选或多选
//
// 任何一处想加字段，只能加在这个文件里；加错地方由 `askUserContract.test.ts` 当场红。
import { z } from "zod";

import type { CapabilityContract } from "./capabilityContract";

/**
 * 拍板的选项数量区间（2026-09-21：2–4 个）。
 *
 * **不写进 schema 当硬约束**：模型多给一个选项时，`.max(4)` 会让整次调用被打回，
 * 而用户那头看到的是「模型又失败了一次」——一个他完全不关心的差别把一次本来能答的
 * 提问变成了一次重试。数量的判词归渲染层（`questionOptionCountIssue`），
 * 说明书里写清楚，校验器不拦。
 */
export const ASK_USER_OPTION_RANGE = Object.freeze({ min: 2, max: 4 });

/** 一个选项。`label` 既是 chip 上印的字，**也是**答案本身——反问卡没有「确认」。 */
export const askUserOptionSchema = z.object({
  /**
   * 这一项的 id。模型不给就由渲染层按位置补 `option-N`。
   * 留着它是因为答案要带一个结构化的「他点的是哪一颗」，而 `label` 会重复。
   */
  id: z.string().trim().min(1).optional()
    .describe("Your id for this option, echoed back on pick. Omit and Nomi numbers them."),
  label: z.string().trim().min(1)
    .describe("Chip text. Picking it sends exactly these words back."),
  description: z.string().trim().min(1).optional()
    .describe("One short line on what picking means; omit rather than restate the label."),
  // `z.literal(true)` 生成的是 `const`，而 Google 的 OpenAPI 3.03 路径不认它
  // （`check:model-schema` 的 `const-instead-of-enum`：这一族只有真模型会用一次失败告诉你）。
  // 所以这里是真 boolean，`false` 与缺席同义——「这一项我不特别推荐」本来就没有第三种意思。
  recommended: z.boolean().optional()
    .describe("True on at most one option, the one you would pick. Only a mark: nothing is preselected or answered for him."),
}).strict();

export type AskUserOption = z.infer<typeof askUserOptionSchema>;

/**
 * **一题。** 卡上一次显示一题。
 *
 * `options` 可以为空：没有现成答案的题目（「你想要什么风格？」）就只剩自由输入那一行，
 * 题照样成立。自由输入**不是一个选项**，是卡的固有能力（2026-09-21 拍板），
 * 所以它不出现在这份 schema 里——模型不需要、也不应该能把它关掉。
 */
export const askUserQuestionSchema = z.object({
  question: z.string().trim().min(1)
    .describe("One sentence in the user's language, answerable on its own."),
  options: z.array(askUserOptionSchema).optional()
    .describe("Two to four one-click answers; omit if there is no short list (he can always type)."),
  multiSelect: z.boolean().optional()
    .describe("True when he may pick several. Default is one answer, submitted on pick."),
  note: z.string().trim().min(1).optional()
    .describe("Optional: why you ask. Not a second question."),
}).strict();

export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;

/**
 * 一次提问，**模型这一侧的全部输入**：一到三题，一张卡问完。
 *
 * ── 为什么是一张卡几题，而不是一题一回合（2026-09-21 用户拍板） ──
 *
 * 版式整件还原 Beautiful UI 的 Approval Card（查证 `scratchpad/askcard-library-findings-0921.md`）：
 * 一张卡可以带几题、**一次显示一题**、页脚写着 `1/3`。对用户来说这是一次打断而不是三次；
 * 一题一回合则是「答完一句、等它想一会、再被问一句」——同一件事被切成三次等待。
 * 上限三题不是审美：再多就不是提问，是问卷（`mcpBriefIntake.ts` 文件头那句「超过 3 题就是 interrogation」）。
 */
export const ASK_USER_QUESTION_RANGE = Object.freeze({ min: 1, max: 3 });

export const askUserInputSchema = z.object({
  questions: z.array(askUserQuestionSchema).min(1)
    .describe("One to three questions on one card, one at a time. Put related questions in a single call, not ask-wait-ask."),
}).strict();

export type AskUserInput = z.infer<typeof askUserInputSchema>;

/** 一题的答复。`optionIds` 只在多选时有多个；`text` **永远有**——模型只认字。 */
export const askUserAnswerSchema = z.object({
  questionIndex: z.number().int().nonnegative(),
  optionIds: z.array(z.string()).optional(),
  text: z.string(),
}).strict();

export type AskUserAnswer = z.infer<typeof askUserAnswerSchema>;

/**
 * **整张卡**的答复 = 答了的那几题 + 明说「这几题他跳过了」。
 *
 * 为什么跳过要显式（2026-09-22，渲染层报告 §10.4-2 登记的契约缺口）：多题卡上用户可以只跳过其中一题。
 * 原来的形状里被跳过的题只是**不出现**在 `answers` 里——模型要知道「第 2 题被跳过」只能靠发现
 * `questionIndex: 1` 缺席，而回给它的那段字连题号都没有（几条 `text` 用换行连起来），
 * 于是「答了 1、3，跳过 2」和「答了 1、2，没有第 3 题」读起来一模一样。
 * 一条答复要么在 `answers` 里、要么在 `skippedQuestionIndexes` 里，不许两头都不在。
 */
export const askUserReplySchema = z.object({
  answers: z.array(askUserAnswerSchema),
  skippedQuestionIndexes: z.array(z.number().int().nonnegative()).optional(),
}).strict();

export type AskUserReply = z.infer<typeof askUserReplySchema>;

/**
 * 回给模型的那段字——**唯一一份**写法（渲染层的 `answerToolResult` 只是调它）。
 *
 * · 一题、答了：只回他的原话。那是最常见的一支，包一层「Question 1:」只会让模型多读一句废话。
 * · 其余（多题，或有跳过）：按卡上的次序逐题写，带题号与问句。跳过的那题**明说是跳过**，
 *   并告诉模型该怎么办——不许替他编一个答案。
 * 只发 `text` 不发 `optionIds`：id 是我们这边的东西，选项的字本来就是模型自己写的。
 */
export function askUserReplyText(questions: readonly string[], reply: AskUserReply): string {
  const skipped = new Set(reply.skippedQuestionIndexes ?? []);
  if (questions.length <= 1 && skipped.size === 0) return reply.answers.map(answer => answer.text).join("\n");
  const byIndex = new Map(reply.answers.map(answer => [answer.questionIndex, answer.text]));
  return questions.map((question, index) => {
    const head = `Question ${index + 1}${question ? ` (${question})` : ""}: `;
    const text = byIndex.get(index);
    if (text !== undefined && !skipped.has(index)) return `${head}${text}`;
    return `${head}the user skipped this question. He chose not to answer it — do not invent an answer for him. Go on without it, or pick the safest default and tell him which one you picked.`;
  }).join("\n");
}

/**
 * 我们**自己**要说的那句话（不是模型写的），所以只传一个码 + 一个数：文案在渲染层 i18n。
 * 生产者传成句的字符串就绕过了 i18n，英文用户会读到中文。
 */
export const askUserHostReasonSchema = z.object({
  code: z.literal("retry_exhausted"),
  attempts: z.number().int().positive(),
}).strict();

export type AskUserHostReason = z.infer<typeof askUserHostReasonSchema>;

/**
 * 一张**待决的**反问卡上会出现的全部字段 = 模型那份 + 两个宿主生产者才写得出的字段。
 *
 * 三个生产者共用同一张卡（渲染层 `agentPanelV4Question.ts` 文件头）：
 *   ① 模型自己调 `ask_user`      → 只有上面那三个字段；
 *   ② 工具缺参数                  → `missingParam`（问句由渲染层按参数名补一句人话）；
 *   ③ 同一字段被拒 3 次后的熔断    → `question` + `options` + `askReason`。
 * 模型**填不出** `missingParam` / `askReason`，所以它们不在 `askUserInputSchema` 里——
 * 让模型能自己声称「这是第 3 次了」就是给它一个伪造理由的字段。
 */
export const askUserPendingArgsSchema = z.object({
  questions: z.array(askUserQuestionSchema).optional(),
  missingParam: z.string().trim().min(1).optional(),
  askReason: askUserHostReasonSchema.optional(),
}).strict().refine(
  (value) => Boolean(value.questions?.length || value.missingParam),
  { message: "A question card needs at least one question, or the name of the missing parameter" },
);

export type AskUserPendingArgs = z.infer<typeof askUserPendingArgsSchema>;

/**
 * 提问能力的契约。
 *
 * · `effect: "read"` —— 它一个字节都不改。因此 `ask` / `editSelection` 两个窄工作模式下
 *   它照样能用：**任何模式下模型都有权说「我不确定」**，那是比动手更安全的一步。
 * · `alwaysAsksUser` —— 见 `capabilityContract.ts` 的字段注释。没有它，一个 `read` 动词会被
 *   `capabilityMayReuseSafeApproval` 直接放行，于是这次「提问」会在用户还没看见卡的时候
 *   自己过去——模型收到一句空答案，用户什么都没被问到。
 * · 不投对外 MCP profile：外部宿主有它自己问人的办法（MCP `elicitation/create`），而这条 lane
 *   在那边 `hasUserInterface = false`，投过去只会得到一句「这里没有窗口可问」。
 */
export const AGENT_ASK_CAPABILITY = {
  id: "agent.ask",
  version: 1,
  aliases: { pi: "ask_user" },
  inputSchema: askUserInputSchema,
  outputSchema: askUserReplySchema,
  effect: "read",
  effectClass: "reversible_local",
  alwaysAsksUser: true,
  execution: { port: "document", availability: "main_or_renderer" },
  exposure: "internal_only",
  requiredScope: "agent:ask",
  targetKind: "project",
} as const satisfies CapabilityContract<AskUserInput, AskUserReply>;

/**
 * 内部面上这个动词叫什么。**从契约的别名取，不在别处手打字符串**——
 * 宿主要按工具名认出「这一次是提问」的地方不止一处，而每多一个手打的 `"ask_user"`
 * 就多一个改名时会悄悄失效的判据（`docs/lessons/stale-directives-outlive-tool-renames.md`）。
 */
export const ASK_USER_VERB_NAME = AGENT_ASK_CAPABILITY.aliases.pi;
