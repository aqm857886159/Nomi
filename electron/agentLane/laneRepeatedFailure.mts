// 「同一个工具连着撞同一堵墙」的计数器（从 laneHost 抽出来，2026-09-17）。
//
// 它解决的真实摩擦：模型收到一句读不懂的错误就把一模一样的调用再发一遍，六次。上游 pi 没有这条
// 规则（它假设错误正文足够可行动），我们两边都做：正文可行动（laneToolContract）**且**连续撞墙有上限。
//
// 「连续」的定义只在这一个文件里：换了 key、成功一次、**或者用户又说了一句话**，计数归零。
// 最后那条是 2026-09-17 真机复现后加的——此前熔断只认工具结果，用户照着 Agent 的建议去点开文稿页也
// 救不回来，整条会话的 read_script 就此报废（`docs/lessons/capability-bound-to-component-lifecycle-reports-stale.md`）。
// 用户动作是回合边界：他既然又开口，就该让工具重新试一次；再撞三次照样拦。
//
// 累计次数不在这里算——「这个工具总在坏」是审计的活，不是拦截的活。
export const LANE_REPEATED_FAILURE_BLOCK = 3;
export const LANE_REPEATED_FAILURE_TERMINATE = 5;

export type LaneRepeatedFailureTracker = Readonly<{
  /** after_tool：记一次结果。失败按「工具名 + 失败正文首行」认；任何别的结果都清零。返回当前连续次数。 */
  note(toolName: string, isError: boolean, body: string): number;
  /** before_tool：这个工具是否已经连着撞到上限；到了就给出模型看到的那句拦截理由。 */
  block(toolName: string): { terminate: boolean; reason: string } | null;
  /** 一条新的用户消息进入 lane：计数归零，工具重新可用。 */
  reset(): void;
}>;

export function createLaneRepeatedFailureTracker(): LaneRepeatedFailureTracker {
  let key = '';
  let count = 0;
  return Object.freeze({
    note(toolName, isError, body) {
      // 为什么是首行：`renderLaneToolFailure` 把 `code` 留给了 UI 分档、没写进正文（那是刻意的，
      // `[error] E_DENIED` 对模型等于没说），而首行正是那句「哪里错、期望什么」——同一堵墙每次都给同一句。
      const next = isError ? `${toolName} ${body.split('\n', 1)[0]}` : '';
      if (next !== key) { key = next; count = next ? 1 : 0; }
      else if (next) count += 1;
      return count;
    },
    block(toolName) {
      if (count < LANE_REPEATED_FAILURE_BLOCK || !key.startsWith(`${toolName} `)) return null;
      return {
        terminate: count >= LANE_REPEATED_FAILURE_TERMINATE,
        reason: `${toolName} has failed the same way ${count} times in a row. `
          + 'Do not send it again in this turn; it becomes available again after the user\'s next message. '
          + 'Either take a different route — a different tool, a narrower scope, values re-read from the current '
          + 'state — or tell the user plainly what is blocking it and what they can change.',
      };
    },
    reset() { key = ''; count = 0; },
  });
}
