// 付费卡这一次出价的结局 → 回给模型的那一句话（2026-09-30 付费卡逐镜）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 以前卡上点一下「仍要生成」，宿主就把别的镜从这一批里删掉再封印，回执却写死一句「都开始了、别再调 generate」：
// 第 2 张悄悄没了，Agent 还告诉用户两张都在生成（用户实见）。现在每一镜各自决定，回执只渲染宿主给的那一个值
// （`GeneratePresentationOutcome`：在生成的 / 用户去掉的 / 画布接手的 / 没决定的 + 原因），不加任何自己的判断。
// 以后这个值原样成为工具调用的输出（Agent 消息层研究 §4.4），这里只是把它读成人话。
//
// 「都开始了」只在每一镜都在生成时才说。
import type { GeneratePresentationOutcome } from "../productionGenerationPresentation";
import type { GenerationPresentationCloser } from "../../productionRun/productionRunTypes";

export type GenerateOutcomeReceipt = Readonly<{ kind: "job_running" | "none"; userSees: string }>;

/** 没决定的那几镜为什么没决定：卡是怎么关的。 */
const UNDECIDED_BECAUSE: Readonly<Record<GenerationPresentationCloser | "open", string>> = {
  user_closed: "the user closed the card (×) before deciding them",
  user_wrote: "the user wrote a message instead of deciding them",
  stopped: "the conversation was stopped before he decided them",
  resolved: "they were not decided on the card",
  open: "they are still waiting on the card",
};

function shotList(shotIds: readonly string[]): string {
  return shotIds.join(", ");
}

/** 宿主给的逐镜结局 → 回执。纯函数：同一个值永远是同一句话（外部 MCP 拿的是这个值本身：operation 视图里的 `presentationOutcome`）。 */
export function describeGenerateOutcome(shots: GeneratePresentationOutcome): GenerateOutcomeReceipt {
  const total = shots.generating.length + shots.failedBeforeSending.length + shots.removed.length
    + shots.takenByCanvas.length + shots.undecided.length;
  const parts: string[] = [];
  if (shots.generating.length > 0) {
    parts.push(shots.generating.length === total
      ? `All ${total} shot(s) on the card are generating; the user clicked generate for each (${shotList(shots.generating)}). His provider credit is being spent and progress shows in the task list.`
      : `Generating now, because the user clicked generate for each of them: ${shotList(shots.generating)}. His provider credit is being spent for these; progress shows in the task list.`);
  }
  if (shots.failedBeforeSending.length > 0) {
    parts.push(`The user clicked generate for ${shotList(shots.failedBeforeSending)}, but it failed before the provider accepted it (it was never sent, or the provider refused it on the spot): nothing was generated and nothing was spent for these.`);
  }
  if (shots.removed.length > 0) {
    parts.push(`The user removed ${shotList(shots.removed)} from the card: they will not be generated, and their placeholder nodes stay on the canvas.`);
  }
  if (shots.takenByCanvas.length > 0) {
    parts.push(`${shotList(shots.takenByCanvas)} were taken over on the canvas while the card was open; they are generated from there, not by this request.`);
  }
  const undecided = shots.undecided.map((entry) => entry.shotId);
  if (undecided.length > 0) {
    const because = UNDECIDED_BECAUSE[shots.undecided[0].reason];
    parts.push(`Not generated and nothing spent for ${shotList(undecided)}: ${because}. The draft keeps them with their placeholders; call generate on this same draft if he wants them later.`);
  }
  const next = shots.generating.length > 0
    ? "Do not call generate again for the shots that are generating."
    : "Do not call generate again right now and do not redraft on your own; ask him what he would like instead.";
  return { kind: shots.generating.length > 0 ? "job_running" : "none", userSees: `${parts.join(" ")} ${next}`.trim() };
}
