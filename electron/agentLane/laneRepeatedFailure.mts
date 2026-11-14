// 「同一个工具连着失败」的计数器（从 laneHost 抽出来，2026-09-17）。
//
// 它解决的真实摩擦：模型收到一句读不懂的错误就把一模一样的调用再发一遍，六次。上游 pi 没有这条
// 规则（它假设错误正文足够可行动），我们两边都做：正文可行动（laneToolContract）**且**连续失败有上限。
//
// 「连续」的定义只在这一个文件里：**这个工具**成功一次、或者用户又说了一句话（被模型读到），计数归零。
// 最后那条是 2026-09-17 真机复现后加的——此前熔断只认工具结果，用户照着 Agent 的建议去点开文稿页也
// 救不回来，整条会话的 read_script 就此报废（`docs/lessons/capability-bound-to-component-lifecycle-reports-stale.md`）。
// 用户动作是回合边界：他既然又开口，就该让工具重新试一次；再失败三次照样拦。
//
// ── 2026-09-22：每个工具各记各的 ──
//
// 真实模型 18 句实测（`docs/evidence/2026-09-21-askback-real-model/`）把上一版的三个洞一次照全了。
// 拿那 121 次调用重放旧计数器：**整轮只有一次摸到 3**，而 `draft_shots` 在 A3 那一轮连错 7 次。
// 三个洞：
//   ① **墙的身份取自失败正文的首行**，而首行里有 id、镜头数、字段值——同一堵墙每次长得不一样
//      （A6：`draft_shots` 连着撞，首行在「Validation failed…」与「The generation action…」之间来回）。
//   ② **一个槽位**：换个工具就把上一堵墙的计数冲掉（A3 的 27 次调用在三个工具之间来回）。
//   ③ **任何一次成功都清零**，包括一次无关的读。A3 seq 30 的 `list_models` 成功把 `draft_shots`
//      连撞两次的计数抹平了，于是它又撞了两次——一次读成功不证明那堵墙倒了。
// 当时的修法是按「工具 + 失败码 + 出错字段路径」分桶，每桶一个计数。
//
// ── 2026-11-09：止损按「这个工具自上次成功以来失败了几次」计，不再按码 / 字段分桶 ──
//
// 分桶让「每次换一个错字段」永远摸不到 3：10 次失败、10 个桶、熔断一次不跳（免费复现：一回合 11 次模型请求）。
// 换错字段不是进展——这个工具一次都没做成。所以止损只认一件事：**这个工具**上次成功之后连着失败了几次。
// ② ③ 照旧堵着（每个工具一个计数；只有它自己成功才清零）；① 不复存在（计数根本不认正文）。
// 码、字段路径、合法值只留作诊断：拒收正文和转提问的选项照旧用它们，计数不看。
// 连续改错不同字段的有限自纠也会在第 3 次停下转提问——这是 2026-11-09 用户拍板接受的取舍。
//
// 累计次数不在这里算——「这个工具总在坏」是审计的活，不是拦截的活。
// 连败满 3 次之后模型还发这个工具 = 无视了「这一轮别再发」：宿主当场结束这一轮（`laneHost.mts` 的回合预算，
// 下一次模型请求不再发出）。墙不再无限地产生「不执行」的立即结果。
export const LANE_REPEATED_FAILURE_BLOCK = 3;

/** 一次失败的诊断事实（`LaneToolPublicFailure` 的子集，不 import 它以免把 zod 那条链拖进来）。计数不看它。 */
export type LaneFailureIdentity = Readonly<{
  code?: string;
  issues?: readonly { readonly path: string }[];
  allowed?: readonly string[];
  /** 起草期被拒的闭合原因：只拿码去报遥测（认墙仍按码 + 字段路径，不按它）。 */
  problem?: { readonly code: string };
}>;

export type LaneRepeatedFailureTracker = Readonly<{
  /**
   * 记一次结果（入参边界和执行层共用）。失败 → 这个工具的连败数 +1；这个工具成功一次 → 它自己归零
   * （别的工具不受影响）。返回这个工具当前的连败数。
   * `failure` 是这次失败的结构化信封（码 / 出错字段 / 合法值清单），只留作诊断。
   * `allowed` 记下来只为一件事：撞到上限转成提问时，那几个值就是现成的选项——
   * 让模型自己回忆「刚才拒收信里写了哪几个值」是在赌它，而那正是它已经连错三次的那件事。
   */
  note(toolName: string, isError: boolean, failure?: LaneFailureIdentity | readonly string[]): number;
  /** 这个工具是否已经连败满 3 次；到了就给出模型看到的那句拦截理由。 */
  block(toolName: string): { reason: string } | null;
  /**
   * 撞满之后那一次**转提问**要带的两个数：这是第几次、上次拒收给的合法值是哪些。
   * `undefined` = 现在没有撞满的连败，这次提问是模型自己要问的（不该盖上「试了 N 次」那句话）。
   */
  exhausted(): { attempts: number; allowed?: readonly string[] } | undefined;
  /** 一条用户消息进了模型的上下文：计数归零，工具重新可用。 */
  reset(): void;
}>;

/** 第三个位置也收一份裸的合法值清单（测试和老调用方的写法）。 */
function identityOf(failure: LaneFailureIdentity | readonly string[] | undefined): LaneFailureIdentity | undefined {
  if (failure === undefined) return undefined;
  return Array.isArray(failure) ? { allowed: failure as readonly string[] } : failure as LaneFailureIdentity;
}

export function createLaneRepeatedFailureTracker(): LaneRepeatedFailureTracker {
  const streaks = new Map<string, { count: number; allowed?: readonly string[] }>();
  let lastTool = "";
  return Object.freeze({
    note(toolName, isError, failure) {
      if (!isError) {
        // 这个工具自己成功了 → 它自己的连败归零。**别的工具一个都不动**：
        // 一次无关的读成功不证明 draft_shots 那条连败结束了（A3 seq 30 就是这么被抹平的）。
        streaks.delete(toolName);
        if (lastTool === toolName) lastTool = "";
        return 0;
      }
      const identity = identityOf(failure);
      const previous = streaks.get(toolName);
      const allowed = identity?.allowed && identity.allowed.length > 0 ? identity.allowed : previous?.allowed;
      const count = (previous?.count ?? 0) + 1;
      streaks.set(toolName, { count, ...(allowed ? { allowed } : {}) });
      lastTool = toolName;
      return count;
    },
    block(toolName) {
      const streak = streaks.get(toolName);
      if (!streak || streak.count < LANE_REPEATED_FAILURE_BLOCK) return null;
      const { count, allowed } = streak;
      return {
        // 2026-09-21：这句话原来的收尾是「换条路，或者跟用户说清是什么挡住了」。
        // 「跟用户说清」在真机上落成的是一段散文，用户读完仍然不知道该回什么——
        // 而此刻缺的恰恰是**一个他答得上来的问题**。所以撞满之后的下一步点名 `ask_user`：
        // 拒收信里那几个合法值直接就是选项，用户点一下这条路就通了。
        // 2026-11-09：再发一次这个工具这一轮就结束（宿主不再发下一次模型请求），这句话要事先说到。
        reason: `${toolName} has failed ${count} times in a row since it last succeeded. `
          + 'Do not send it again in this turn: one more call to it ends this turn at once. '
          + 'It becomes available again after the user\'s next message. '
          + 'Either take a different route — a different tool, a narrower scope, values re-read from the current state — '
          + 'or, when the thing you cannot get right is something only the user can decide, ask him with ask_user'
          + (allowed && allowed.length > 0
            ? `, offering the values this call would accept: ${allowed.slice(0, 4).join(', ')}.`
            : ', offering the two to four answers you would choose between.'),
      };
    },
    exhausted() {
      const streak = streaks.get(lastTool);
      if (!streak || streak.count < LANE_REPEATED_FAILURE_BLOCK) return undefined;
      return { attempts: streak.count, ...(streak.allowed && streak.allowed.length > 0 ? { allowed: streak.allowed } : {}) };
    },
    reset() { streaks.clear(); lastTool = ""; },
  });
}
