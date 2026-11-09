// 「同一个工具连着撞同一堵墙」的计数器（从 laneHost 抽出来，2026-09-17）。
//
// 它解决的真实摩擦：模型收到一句读不懂的错误就把一模一样的调用再发一遍，六次。上游 pi 没有这条
// 规则（它假设错误正文足够可行动），我们两边都做：正文可行动（laneToolContract）**且**连续撞墙有上限。
//
// 「连续」的定义只在这一个文件里：**这个工具**成功一次、或者用户又说了一句话，计数归零。
// 最后那条是 2026-09-17 真机复现后加的——此前熔断只认工具结果，用户照着 Agent 的建议去点开文稿页也
// 救不回来，整条会话的 read_script 就此报废（`docs/lessons/capability-bound-to-component-lifecycle-reports-stale.md`）。
// 用户动作是回合边界：他既然又开口，就该让工具重新试一次；再撞三次照样拦。
//
// ── 2026-09-22：墙按**语义码**认，而且每堵墙各记各的 ──
//
// 真实模型 18 句实测（`docs/evidence/2026-09-21-askback-real-model/`）把上一版的三个洞一次照全了。
// 拿那 121 次调用重放旧计数器：**整轮只有一次摸到 3**，而 `draft_shots` 在 A3 那一轮连错 7 次。
// 三个洞：
//   ① **墙的身份取自失败正文的首行**，而首行里有 id、镜头数、字段值——同一堵墙每次长得不一样
//      （A6：`draft_shots` 连着撞，首行在「Validation failed…」与「The generation action…」之间来回）。
//   ② **一个槽位**：换个工具就把上一堵墙的计数冲掉（A3 的 27 次调用在三个工具之间来回）。
//   ③ **任何一次成功都清零**，包括一次无关的读。A3 seq 30 的 `list_models` 成功把 `draft_shots`
//      连撞两次的计数抹平了，于是它又撞了两次——一次读成功不证明那堵墙倒了。
// 现在：墙 = 工具 + 失败码（+ 出错字段路径），认不出码时才退回首行；每堵墙一个计数；
// **只有这个工具自己成功**才清掉它自己的墙。
//
// 累计次数不在这里算——「这个工具总在坏」是审计的活，不是拦截的活。
// 2026-11-07：删掉了「第 5 次终止整轮」。它从来到不了——被拦下的调用不记数，计数停在 3 直到用户再开口；
// 而形状错的调用（pi 的立即结果）连 3 都摸不到。现在墙判在入参边界（`laneToolInputBoundary.mts`），
// 拦截是一次立即结果，本来也没有「终止」这个出口。
export const LANE_REPEATED_FAILURE_BLOCK = 3;

/** 认墙用的那几件事实（`LaneToolPublicFailure` 的子集，不 import 它以免把 zod 那条链拖进来）。 */
export type LaneFailureIdentity = Readonly<{
  code?: string;
  issues?: readonly { readonly path: string }[];
  allowed?: readonly string[];
  /** 起草期被拒的闭合原因：只拿码去报遥测（认墙仍按码 + 字段路径，不按它）。 */
  problem?: { readonly code: string };
}>;

/** 分隔符。工具名、失败码、字段路径都是标识符，不会含 `::`。 */
const SEP = "::";

/**
 * 一堵墙的身份。
 *
 * 有码就按码 + 出错字段路径算——那才是「同一件事错了同一次」的稳定表达；正文里带着 id、镜头数、
 * 字段值，每次都不一样。没有码（pi 自己的 ajv 报错走的就是这条）才退回首行：那一行是
 * `Validation failed for tool "draft_shots":`，本身是稳定的。
 */
export function laneWallKey(toolName: string, body: string, failure?: LaneFailureIdentity): string {
  if (failure?.code) {
    const paths = [...new Set((failure.issues ?? []).map((issue) => issue.path))].sort().join(",");
    return `${toolName}${SEP}${failure.code}${paths ? `${SEP}${paths}` : ""}`;
  }
  return `${toolName}${SEP}${body.split("\n", 1)[0]?.slice(0, 200) ?? ""}`;
}

export type LaneRepeatedFailureTracker = Readonly<{
  /**
   * after_tool：记一次结果。失败按 `laneWallKey` 认墙，**每堵墙各记各的**；
   * 这个工具成功一次 → 清掉它自己的全部墙（别的工具的墙不受影响）。返回这堵墙的当前次数。
   * `failure` 是这次失败的结构化信封（码 / 出错字段 / 合法值清单）。
   * `allowed` 记下来只为一件事：撞到上限转成提问时，那几个值就是现成的选项——
   * 让模型自己回忆「刚才拒收信里写了哪几个值」是在赌它，而那正是它已经连错三次的那件事。
   */
  note(toolName: string, isError: boolean, body: string, failure?: LaneFailureIdentity | readonly string[]): number;
  /** 入参边界：这个工具是否已经撞满某一堵墙；到了就给出模型看到的那句拦截理由。 */
  block(toolName: string): { reason: string } | null;
  /**
   * 撞满之后那一次**转提问**要带的两个数：这是第几次、上次拒收给的合法值是哪些。
   * `undefined` = 现在没有撞满的连败，这次提问是模型自己要问的（不该盖上「试了 N 次」那句话）。
   */
  exhausted(): { attempts: number; allowed?: readonly string[] } | undefined;
  /** 一条新的用户消息进入 lane：计数归零，工具重新可用。 */
  reset(): void;
}>;

/** 兼容旧签名：第四个位置曾经只收 `allowed`。 */
function identityOf(failure: LaneFailureIdentity | readonly string[] | undefined): LaneFailureIdentity | undefined {
  if (failure === undefined) return undefined;
  return Array.isArray(failure) ? { allowed: failure as readonly string[] } : failure as LaneFailureIdentity;
}

export function createLaneRepeatedFailureTracker(): LaneRepeatedFailureTracker {
  const walls = new Map<string, { count: number; allowed?: readonly string[] }>();
  let lastKey = "";
  return Object.freeze({
    note(toolName, isError, body, failure) {
      const identity = identityOf(failure);
      if (!isError) {
        // 这个工具自己成功了 → 它自己的墙全部倒掉。**别的工具的墙一堵都不动**：
        // 一次无关的读成功不证明 draft_shots 那堵墙倒了（A3 seq 30 就是这么被抹平的）。
        for (const key of [...walls.keys()]) if (key.startsWith(`${toolName}${SEP}`)) walls.delete(key);
        lastKey = "";
        return 0;
      }
      const key = laneWallKey(toolName, body, identity);
      const previous = walls.get(key);
      const allowed = identity?.allowed && identity.allowed.length > 0 ? identity.allowed : previous?.allowed;
      const count = (previous?.count ?? 0) + 1;
      walls.set(key, { count, ...(allowed ? { allowed } : {}) });
      lastKey = key;
      return count;
    },
    block(toolName) {
      const prefix = `${toolName}${SEP}`;
      let worst: { count: number; allowed?: readonly string[] } | undefined;
      for (const [key, wall] of walls) {
        if (!key.startsWith(prefix)) continue;
        if (!worst || wall.count > worst.count) worst = wall;
      }
      if (!worst || worst.count < LANE_REPEATED_FAILURE_BLOCK) return null;
      const { count, allowed } = worst;
      return {
        // 2026-09-21：这句话原来的收尾是「换条路，或者跟用户说清是什么挡住了」。
        // 「跟用户说清」在真机上落成的是一段散文，用户读完仍然不知道该回什么——
        // 而此刻缺的恰恰是**一个他答得上来的问题**。所以撞满之后的下一步点名 `ask_user`：
        // 拒收信里那几个合法值直接就是选项，用户点一下这条路就通了。
        reason: `${toolName} has failed the same way ${count} times in a row. `
          + 'Do not send it again in this turn; it becomes available again after the user\'s next message. '
          + 'Either take a different route — a different tool, a narrower scope, values re-read from the current state — '
          + 'or, when the thing you cannot get right is something only the user can decide, ask him with ask_user'
          + (allowed && allowed.length > 0
            ? `, offering the values this call would accept: ${allowed.slice(0, 4).join(', ')}.`
            : ', offering the two to four answers you would choose between.'),
      };
    },
    exhausted() {
      const wall = walls.get(lastKey);
      if (!wall || wall.count < LANE_REPEATED_FAILURE_BLOCK) return undefined;
      return { attempts: wall.count, ...(wall.allowed && wall.allowed.length > 0 ? { allowed: wall.allowed } : {}) };
    },
    reset() { walls.clear(); lastKey = ""; },
  });
}
