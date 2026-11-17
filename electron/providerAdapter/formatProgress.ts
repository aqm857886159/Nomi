// 「这个模型的格式任务正在跑」——界面能拿到的唯一一点任务状态（D-1117-delete-verification）。
// 任务状态本身（`meta.adapter.state`）只住在格式任务生命周期里，不过 IPC；界面只拿这一个布尔，
// 交给 `electron/shared/modelStatusPresentation.ts` 说成「配置中」。没有「验没验过」这一档。
export function modelFormatInProgress(meta: unknown): boolean {
  const record = meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : undefined;
  const adapter = record?.adapter && typeof record.adapter === "object" ? record.adapter as Record<string, unknown> : undefined;
  return adapter?.state === "testing";
}
