// 「这一笔付费，此刻正由**档位**代答」——进程内**唯一**的那份事实（2026-09-18 · T-AG-04）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 用户把档位切到「全自动」，Agent 说「好，我来生成」，然后面板上**还是弹出一张报价卡**。
// 他刚刚才在切档卡上答应过「付费生成直接跑、不再逐笔给我看报价」，转头又被问一遍。
//
// 成因是投影与决定之间的**时间差**：草稿一落盘，`projectPendingSpendConfirm` 就把它投影成
// 一张「在等你点头」的卡（Run 一变就推给面板），而「全自动」档代答的那一步
// （`generationTransportAdapters.ts` 的 `decideByPolicyAfterDraft`）跑在落盘**之后**。
// 两者之间那一段，卡是真的摆在用户面前的。
//
// ── 为什么修法是「这一笔正在被代答」，而不是「全自动档一律不出卡」──
//
// 后者少考虑了一种真实操作：用户**正看着一张卡**的时候把档位切到全自动。那一刻按「档位」
// 一刀切，卡会当场消失——而没有任何东西会去回答它（代答只发生在草稿刚建好那一步）。
// 结果是草稿悬在 Run 里、画布上留着一排没人认领的占位节点、用户看到的是沉默。
// 那正是 `productionPendingSpend.ts` 文件头反复警告的那种失败。
//
// 所以这里记的是一件**当下的、有始有终的**事实：「`operationId` 这一笔，档位已经接手了，
// 正在按同一道闸决它」。三种结局各自对：
//   · 代答成功 → 计划在释放之前就已封印/开跑，卡从头到尾没出现过；
//   · 代答失败 → `finally` 释放，卡**回到原处等用户**（「策略答不了才问人」，裁决要求保留）；
//   · 进程重启 → 这份事实随进程消失，遗留的草稿照常出卡。重启后没有任何代答在飞，
//     出卡是诚实的那一边。
//
// ── 判据仍只有一个 owner ──
//
// 「这一档要不要问」由 `capabilityApprovalPolicy.ts` 的 `spendDecidedByPolicy` 回答，
// **只在写入端**（适配器）问一次；这里只存它答完之后的那件事实，投影端不再重问一遍。
// 重问就是第二份判据，而档位恰恰是钱这条轴上最不该有两个答案的东西。

/** `${projectId}:${operationId}` → 还没释放的代答数（同一笔理论上只有一次，计数是为了不被重入清早）。 */
const inFlight = new Map<string, number>();
const listeners = new Set<(projectId: string, operationId: string) => void>();

/**
 * 代答收尾了（释放）。对话投影据此重读一次待决出价：代答失败时卡要**回到原处等用户**，
 * 而释放本身不写 Run 账本——没有这一声，那张卡要等到账本下一次变才出现（轮询时代这一段靠 1.5 秒兜着）。
 */
export function subscribePolicySpendDecisions(listener: (projectId: string, operationId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function keyOf(projectId: string, operationId: string): string {
  return `${projectId}:${operationId}`;
}

/**
 * 标记「这一笔由档位代答中」。返回**释放函数**，调用方必须放进 `finally`——
 * 不释放的后果不是崩溃，是这一笔的报价卡从此永远不出现（最坏的那种静默）。
 * 释放是幂等的。
 */
export function beginPolicySpendDecision(projectId: string, operationId: string): () => void {
  const key = keyOf(projectId, operationId);
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (inFlight.get(key) ?? 1) - 1;
    if (count > 0) inFlight.set(key, count);
    else inFlight.delete(key);
    for (const listener of [...listeners]) listener(projectId, operationId);
  };
}

/** 这一笔此刻是不是正由档位代答？`true` = 别把它投影成「在等你点头」。 */
export function spendAnsweredByPolicy(projectId: string, operationId: string): boolean {
  return inFlight.has(keyOf(projectId, operationId));
}
