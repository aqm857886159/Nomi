/**
 * 「项目位置」被拒的两种跨进程身份（主进程抛、渲染层认；渲染层只依赖这里，不伸手进主进程实现）。
 *
 * 1. 位置在 Nomi 自己的目录里（安装目录 / 应用数据 / 系统临时目录）：升级、卸载或系统清理会把里面的项目删掉。
 *    判定只有一个：electron/workspace/workspaceLocationPolicy.ts 的 findAppOwnedLocation。
 * 2. 打开的文件夹是另一个项目文件夹的副本：同一个项目 id 已经登记在另一个还在、还装着这个 id 的文件夹上。
 *    不改绑、不往任何一个里写，先拒绝（收敛单不变量 ⑤，协调 2026-10-29）。判定在 electron/workspace/workspaceRegistry.ts。
 *
 * 同步 IPC（新建项目）只带回错误信息文本，invoke 只带回 `类名: 信息`——类与自定义字段都过不来（见 ipcInvokeFailure.ts）。
 * 所以名字和要给人看的参数都写进信息里：照 ProjectTrashFailedError[原因]: 的写法。零依赖：主进程、渲染层都引它。
 */

export const PROJECT_LOCATION_REJECTED_ERROR_NAME = "ProjectLocationRejectedError";
/** install = 安装目录（含 resources）；app-data = 应用数据 / 设置根；temp = 系统临时目录。 */
export const APP_OWNED_LOCATION_KINDS = ["install", "app-data", "temp"] as const;
export type AppOwnedLocationKind = (typeof APP_OWNED_LOCATION_KINDS)[number];

export function projectLocationRejectedError(kind: AppOwnedLocationKind, location: string): Error {
  const error = new Error(`${PROJECT_LOCATION_REJECTED_ERROR_NAME}[${kind}]: refusing to keep projects inside Nomi's own ${kind} directory (${location})`);
  error.name = PROJECT_LOCATION_REJECTED_ERROR_NAME;
  return error;
}

/** 认得出直接拿到的、经 IPC 包过一层（只剩信息文本）的、或挂在 cause 上的。认不出返回 null。 */
export function projectLocationRejection(error: unknown): AppOwnedLocationKind | null {
  if (!error || typeof error !== "object") return null;
  const { message, cause } = error as { message?: unknown; cause?: unknown };
  if (typeof message === "string") {
    const match = message.match(/ProjectLocationRejectedError\[([a-z-]+)\]:/);
    if (match && (APP_OWNED_LOCATION_KINDS as readonly string[]).includes(match[1])) return match[1] as AppOwnedLocationKind;
  }
  return cause !== undefined && cause !== error ? projectLocationRejection(cause) : null;
}

export const WORKSPACE_FOLDER_COPY_ERROR_NAME = "WorkspaceFolderCopyError";
export type WorkspaceFolderCopy = { projectName: string; originalRootPath: string };

export function workspaceFolderCopyError(copy: WorkspaceFolderCopy): Error {
  const error = new Error(`${WORKSPACE_FOLDER_COPY_ERROR_NAME}: ${JSON.stringify({ projectName: copy.projectName, originalRootPath: copy.originalRootPath })}`);
  error.name = WORKSPACE_FOLDER_COPY_ERROR_NAME;
  return error;
}

/** 同上的三种拿法都认；参数是信息末尾那段 JSON。认不出返回 null。 */
export function workspaceFolderCopy(error: unknown): WorkspaceFolderCopy | null {
  if (!error || typeof error !== "object") return null;
  const { message, cause } = error as { message?: unknown; cause?: unknown };
  if (typeof message === "string") {
    const match = message.match(/WorkspaceFolderCopyError: (\{.*\})\s*$/s);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]) as Partial<WorkspaceFolderCopy>;
        if (typeof parsed.projectName === "string" && typeof parsed.originalRootPath === "string") {
          return { projectName: parsed.projectName, originalRootPath: parsed.originalRootPath };
        }
      } catch {
        // 不是我们写的那段 JSON：当认不出
      }
    }
  }
  return cause !== undefined && cause !== error ? workspaceFolderCopy(cause) : null;
}
