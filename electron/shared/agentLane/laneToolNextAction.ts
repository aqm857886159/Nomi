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
export interface LaneToolNextAction {
  readonly kind: VerbNextAction;
  readonly userSees: string;
  readonly jobId?: string;
  readonly cardId?: string;
  /** 给 `undo` 用；`reversible_local` 的写动词必有。 */
  readonly changeId?: string;
}

/** 信封 → 模型看到的尾行。**唯一渲染点**，与失败正文的 `Next:` 行同一形状。 */
export function renderLaneToolNextAction(next: LaneToolNextAction): string {
  const refs = [
    ...(next.changeId ? [`changeId=${next.changeId}`] : []),
    ...(next.jobId ? [`jobId=${next.jobId}`] : []),
    ...(next.cardId ? [`cardId=${next.cardId}`] : []),
  ];
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

/**
 * 模型看到的工具结果正文 → **面板该印的那一段**。去掉的只有宿主自己拼上去的那一行尾巴
 * （按信封重新渲染一次，逐字对齐才去），其余一个字不动。
 * 没有信封、或尾巴对不上（旧转录、被截断）就原样返回：宁可多印一行，不许猜着删正文。
 */
export function laneToolTextForUser(text: string, nextAction: LaneToolNextAction | undefined): string {
  if (!nextAction) return text;
  const tail = `\n${renderLaneToolNextAction(nextAction)}`;
  return text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}
