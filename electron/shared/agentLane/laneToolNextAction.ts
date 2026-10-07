// 一次成功的写动词「接下来用户会看到什么」——**这一行有两个读者，而它们要读到的不是同一段字**。
//
// · **模型**读的是工具结果正文末尾那一行 `User sees: …`（`renderLaneToolNextAction`）。宿主替它写好
//   「用户那边现在是什么样」，它就不必自己编「已经生成好了」——这是 §6.2 那条不变量的全部意义。
// · **用户**读的是面板上那一行收据。那一行不该印这句话：它是英文、用第三人称讲用户自己
//   （"the user can undo it with Cmd+Z"），而且它讲的那件事面板已经**画**出来了（撤销钮、确认卡）。
//   原样印出去 = 同一件事说两遍，其中一遍还不是用户文案（它住主进程，i18n 词表管不到它）。
//
// 所以这个文件把「那一行长什么样」做成**唯一渲染点**，并同时给出它的**结构来源**
// （`details.nextAction`，由 `laneTools.mts` 写进工具结果）。渲染层据此按结构去尾，
// 而不是去认 "User sees:" 这个前缀——渲染格式改了，去尾跟着改，不会漏。
//
// 本文件**一个运行时依赖都没有**（`kind` 是 `import type`，编译后一行不剩）：投影与渲染层都要 import 它，
// 而投影那一层的文件头写明了为什么它不能拖进 pi/zod（#614 白屏）。
import type { VerbNextAction } from "../agentCapabilities/modelFacingTools";

/**
 * 写动词成功时的返回信封（设计正本 §6.2）：用户接下来会看到什么。`userSees` 是宿主写的一句人话，
 * **给模型转述用**，不是给用户读的文案。
 */
/**
 * 末行里那几个「引用」：宿主把模型**下一步要填的那个值**递回去。所以每个名字都必须是某个动词
 * schema 上真的有的字段——它是一句指令（「把这个填进去」），不是一个标签。
 *
 * 2026-10-04 画布和时间轴的可逆写入现在都回传 `changeId`，模型侧 `undo` 也收同一个字段；
 * `draft_shots` 的草稿 id 被印成 `jobId`，而下一步 `draft_shots` / `generate` 要求
 * 填 `operationId`。模型读到一个名字、必须填另一个，中间没有任何提示——两条都不是翻译层的问题，
 * 是**模型面自己**的问题。`cardId` 则是第三种：全仓没有任何地方写过它，也没有任何动词收它。
 *
 * 名单在这里，是为了让「这个名字有没有动词真的收」成为一条可机器核的断言
 * （`laneExtendedTools.test.ts` 的三条），而不是每加一个引用都靠人记得去对一遍注册表。
 */
export const LANE_TOOL_NEXT_ACTION_REFS = ["changeId", "operationId", "jobId"] as const;

export interface LaneToolNextAction {
  readonly kind: VerbNextAction;
  readonly userSees: string;
  /** 给 `undo` 用；`reversible_local` 的写动词必有。名字与 `undo` 收的字段、与契约声明的返回字段同一个词。 */
  readonly changeId?: string;
  /** 草稿 id：`draft_shots` 与 `generate` 都按这个名字收它。 */
  readonly operationId?: string;
  /** 已经在跑的那一笔：`check_job` / `cancel_job` 按这个名字收它（双域，见 `verbs/verbDualDomain.ts`）。 */
  readonly jobId?: string;
}

/** 信封 → 模型看到的尾行。**唯一渲染点**，与失败正文的 `Next:` 行同一形状。 */
export function renderLaneToolNextAction(next: LaneToolNextAction): string {
  const refs = LANE_TOOL_NEXT_ACTION_REFS.flatMap((key) => (next[key] ? [`${key}=${next[key]!}`] : []));
  return `User sees: ${next.userSees}${refs.length > 0 ? ` (${refs.join(", ")})` : ""}`;
}

/**
 * 工具结果 `details` 里那份信封的读回。`laneTools.mts` 把它与渲染好的尾行**同时**写进结果
 * （`details.nextAction` + 正文末行），所以读回它 = 拿到那一行的结构来源。
 * 形状不对就当没有：这里不能抛——一条历史转录里的任何东西都可能是旧版本写的。
 */
export function laneToolNextActionOf(details: unknown): LaneToolNextAction | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const candidate = (details as { nextAction?: unknown }).nextAction;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  if (typeof record.kind !== "string" || typeof record.userSees !== "string") return undefined;
  return record as unknown as LaneToolNextAction;
}
