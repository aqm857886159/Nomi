// 走查探针：宿主此刻那份「有没有一笔钱在等用户点头」（PendingSpendRead）。
//
// 2026-10-05 付费卡并进对话投影之后，这份事实唯一的来路是推给面板的对话投影（`LaneWorkspaceProjection.spend`），
// 渲染层没有第二条去拉它的 IPC。探针读的就是面板手上那一份（`laneClient.ts` 末尾的只读 E2E 桥）。
// 返回 `null` = 投影还没到（或没有打开的项目）。

/** @param {import('playwright').Page} win */
export async function readLaneSpend(win) {
  return win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    return window.__nomiLaneWorkspace?.spend ?? null
  })
}
