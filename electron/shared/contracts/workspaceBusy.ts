/**
 * 「项目正被别处占用」的跨进程身份（渲染层只依赖这里，不伸手进主进程实现）。
 *
 * 主进程拿不到项目 manifest 锁时抛的错就叫这个名字（`electron/workspace/workspaceManifestLock.ts`）。
 * Electron 的 `ipcRenderer.invoke` 只把 `名字: 信息` 这段文本带回渲染层——错误码与类都丢了，
 * 于是渲染层原来一律报「请检查本地磁盘权限」，把用户支去查一个根本没坏的东西（2026-09-24 反馈）。
 * 名字在这里定义一次、两边都 import：认的是**我们自己的类名**，不是去匹配一句英文信息。
 */
export const WORKSPACE_MANIFEST_BUSY_ERROR_NAME = "WorkspaceManifestLockBusyError";

/** 直接拿到的锁忙错误、经 IPC 包过一层的、或被渲染层再包一层放在 `cause` 上的，都认。 */
export function isWorkspaceBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message, cause } = error as { name?: unknown; message?: unknown; cause?: unknown };
  if (name === WORKSPACE_MANIFEST_BUSY_ERROR_NAME) return true;
  if (typeof message === "string" && message.includes(`${WORKSPACE_MANIFEST_BUSY_ERROR_NAME}:`)) return true;
  return cause !== undefined && cause !== error && isWorkspaceBusyError(cause);
}
