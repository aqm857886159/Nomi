// 付费卡上「每一次出价」的仲裁器（每次出价一份：projectId + operationId）：卡上的动作怎么排、× 怎么打断、结局什么时候算定。
// 方案与复盘：docs/plan/2026-10-10-spend-arbiter.md（用户 2026-10-10 拍板「换」：删掉 × 绕过队列的特例）。
//
// ── 三件事，一个入口 ──
// 1. 队：卡上的动作（生成这张 / 去掉这张 / 生成剩下）一个接一个跑完，后一下读到的是前一下落盘之后的 Run
//    （「同一镜只发一次」靠的就是这个顺序，而不是渲染层的防抖）。
// 2. 取消令牌：× 不排队（要的就是能打断），但它**同步**登记一枚令牌（`registerCancel`），队里的动作在每个会产生副作用的
//    步骤前（落画布、拿租约、开门、决门）问同一枚令牌：已登记就不再往下走。令牌之后没交出去的镜，一律不交。
//    「交」的分界是授权落账（门批下来、Run 账本里这一镜算「正在生成」）：之后派发是承诺，不是选择——账本没有「批了但不发」
//    这个状态，硬撤只会让界面、回执、账本说不到一起。所以 × 来晚了，如实说已发出，不报错。
// 3. 封存终态：说结局的地方（× 回给卡的那一句、Agent 的回执、lane）都经 `sealedOutcome`：先等队里的动作落定，再读 Run，
//    读到的就是宿主最终批下的那一份。不各自猜，也不各存一份「批到第几张」。
//
// 进程内、不落盘：进程死了队和令牌都没了（那一次出价由启动清扫收回，见 `stalePresentationSweep.ts`）；事实永远在 Run 账本。

type Slot = { tail: Promise<unknown> | undefined; cancels: number };
const slots = new Map<string, Slot>();

function keyOf(projectId: string, operationId: string): string {
  return `${projectId}:${operationId}`;
}

function slotOf(projectId: string, operationId: string): Slot {
  const key = keyOf(projectId, operationId);
  let slot = slots.get(key);
  if (!slot) { slot = { tail: undefined, cancels: 0 }; slots.set(key, slot); }
  return slot;
}

function dropIfIdle(projectId: string, operationId: string): void {
  const slot = slots.get(keyOf(projectId, operationId));
  if (slot && !slot.tail && slot.cancels === 0) slots.delete(keyOf(projectId, operationId));
}

/** 把卡上的这一下排进这一次出价的队：前面的都跑完（成或败）才轮到它。 */
export function serializeCardAction<T>(projectId: string, operationId: string, run: () => Promise<T>): Promise<T> {
  const slot = slotOf(projectId, operationId);
  // 前一下的失败已经原样交给了它自己的调用方（它拿到的就是那个 promise）；这里只是不让它卡住后一下。
  const next = (slot.tail ?? Promise.resolve()).catch(() => undefined).then(run);
  slot.tail = next;
  void next.finally(() => {
    if (slot.tail === next) { slot.tail = undefined; dropIfIdle(projectId, operationId); }
  }).catch(() => undefined);
  return next;
}

/** 等这一次出价在队里的动作都落定（队空 → 立刻）。之后读 Run，读到的就是宿主最终批下的那一份。 */
export async function cardActionsSettled(projectId: string, operationId: string): Promise<void> {
  // 等的时候又排进来一下（卡关了之后它会当场失败）：接着等，直到队空。
  for (let tail = slots.get(keyOf(projectId, operationId))?.tail; tail; tail = slots.get(keyOf(projectId, operationId))?.tail) {
    await tail.catch(() => undefined);
  }
}

/**
 * × 登记取消令牌（**同步**，在它自己的任何一个 await 之前）。返回释放函数：× 把结局说完之后调用，令牌随之消失，
 * 之后对同一份草稿再出价（同一个 operationId）不受这一枚影响。
 */
export function registerCancel(projectId: string, operationId: string): () => void {
  const slot = slotOf(projectId, operationId);
  slot.cancels += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    slot.cancels -= 1;
    dropIfIdle(projectId, operationId);
  };
}

/** 这一次出价上有没有 × 已经登记、还没说完结局。队里的动作在每个有副作用的步骤前问这一句。 */
export function spendCancelRequested(projectId: string, operationId: string): boolean {
  return (slots.get(keyOf(projectId, operationId))?.cancels ?? 0) > 0;
}

/** 封存终态：先等队里的动作落定，再用调用方的读法读 Run。UI（×）、回执、lane 都从这一个口读。 */
export async function sealedOutcome<T>(projectId: string, operationId: string, read: () => T): Promise<T> {
  await cardActionsSettled(projectId, operationId);
  return read();
}
