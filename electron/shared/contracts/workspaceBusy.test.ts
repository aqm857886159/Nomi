// 「项目正被别处占用」的跨进程身份：主进程的锁错误与渲染层的判据必须认的是同一个名字。
// 钉住的是真实那条路：主进程抛 → Electron invoke 只带回「名字: 信息」→ 渲染层据此挑文案。
import { describe, expect, it } from "vitest";
import { WorkspaceManifestLockBusyError } from "../../workspace/workspaceManifestLock";
import { isWorkspaceBusyError, WORKSPACE_MANIFEST_BUSY_ERROR_NAME } from "./workspaceBusy";

/** Electron 43 的 invoke 拒绝形状：原错误的类与 code 都没了，只剩这一句。 */
function throughIpc(error: Error): Error {
  return new Error(`Error invoking remote method 'nomi:projects:save-async': ${String(error)}`);
}

describe("isWorkspaceBusyError", () => {
  it("主进程的锁忙错误就叫共享的那个名字（改了类名这里会红，而不是渲染层悄悄认不出）", () => {
    const busy = new WorkspaceManifestLockBusyError("Workspace manifest is owned on another host");
    expect(busy.name).toBe(WORKSPACE_MANIFEST_BUSY_ERROR_NAME);
    expect(isWorkspaceBusyError(busy)).toBe(true);
  });

  it("经过 IPC 只剩一句话，也认得出", () => {
    expect(isWorkspaceBusyError(throughIpc(new WorkspaceManifestLockBusyError()))).toBe(true);
  });

  it("渲染层又包一层、真因放在 cause 上，也认得出", () => {
    const wrapped = new Error("save failed", { cause: throughIpc(new WorkspaceManifestLockBusyError()) });
    expect(isWorkspaceBusyError(wrapped)).toBe(true);
  });

  it("真的磁盘权限问题不算占用——那句「请检查本地磁盘权限」仍然是对的", () => {
    const denied = Object.assign(new Error("EACCES: permission denied, open 'x'"), { code: "EACCES" });
    expect(isWorkspaceBusyError(throughIpc(denied))).toBe(false);
    expect(isWorkspaceBusyError(denied)).toBe(false);
    expect(isWorkspaceBusyError("WorkspaceManifestLockBusyError")).toBe(false);
    expect(isWorkspaceBusyError(null)).toBe(false);
  });
});
