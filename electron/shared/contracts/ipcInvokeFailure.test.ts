// Electron invoke 失败那句话的唯一读法：读得回主进程错误的类名、码、消息；剥壳与它替掉的两份私有正则逐字相同；
// 「代码里定义的类名」这一种形状盖住全仓代码里写下的每一个错误类名，又不放行别的东西。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WorkspaceManifestLockBusyError } from "../../workspace/workspaceManifestLock";
import { WORKSPACE_MANIFEST_BUSY_ERROR_NAME } from "./workspaceBusy";
import {
  CODE_CLASS_NAME,
  createStructuredIpcFailure,
  ipcInvokeFailure,
  isCodeClassName,
  readIpcFailureMessage,
  readStructuredIpcFailure,
  withoutIpcInvokeWrapper,
} from "./ipcInvokeFailure";
import { IpcResultError } from "./ipcResult";

/**
 * 真形状（Electron 43）：主进程 handle 抛错 → 主进程侧回 `error.toString()`；渲染层 ipcRenderer.invoke 里
 * `throw new Error(\`Error invoking remote method '${channel}': ${error}\`)`。主进程那一侧抛什么，这里就传什么。
 */
function overInvoke(channel: string, thrownInMain: unknown): string {
  return new Error(`Error invoking remote method '${channel}': ${String(thrownInMain)}`).message;
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("ipcInvokeFailure：读回主进程那个错误", () => {
  it("我们自己的错误类：通道、类名、消息", () => {
    const thrown = new WorkspaceManifestLockBusyError("Workspace manifest is owned on another host");
    expect(ipcInvokeFailure(overInvoke("nomi:projects:save-async", thrown))).toEqual({
      channel: "nomi:projects:save-async",
      name: WORKSPACE_MANIFEST_BUSY_ERROR_NAME,
      message: "Workspace manifest is owned on another host",
    });
  });

  it("Node 内部错误的 toString 自带码：类名和码都读回来", () => {
    const thrown = caught(() => Buffer.alloc(-1)) as Error & { code?: string };
    const failure = ipcInvokeFailure(overInvoke("nomi:assets:read", thrown));
    expect(failure).toMatchObject({ name: "RangeError", code: thrown.code, message: thrown.message });
  });

  it("消息为空时 toString 只有类名；消息跨行时整段都是消息", () => {
    class EmptyMessageError extends Error {
      constructor() {
        super("");
        this.name = "EmptyMessageError";
      }
    }
    expect(ipcInvokeFailure(overInvoke("nomi:x", new EmptyMessageError()))).toEqual({ channel: "nomi:x", name: "EmptyMessageError", message: "" });
    expect(ipcInvokeFailure(overInvoke("nomi:x", new Error("first line\n    at second (x.js:1:1)")))?.message).toBe("first line\n    at second (x.js:1:1)");
  });

  it("主进程抛的不是 Error（一句字符串、一个普通对象）：没有类名，整段是消息", () => {
    expect(ipcInvokeFailure(overInvoke("nomi:x", "host refused"))).toEqual({ channel: "nomi:x", message: "host refused" });
    expect(ipcInvokeFailure(overInvoke("nomi:x", "Workspace manifest is busy"))).toEqual({ channel: "nomi:x", message: "Workspace manifest is busy" });
    expect(ipcInvokeFailure(overInvoke("nomi:x", { reason: "x" }))).toEqual({ channel: "nomi:x", message: "[object Object]" });
  });

  it("不是 invoke 的那句话（渲染层自己的错误、不是字符串）：null，不抛", () => {
    expect(ipcInvokeFailure("WorkspaceManifestLockBusyError: busy")).toBeNull();
    expect(ipcInvokeFailure("save failed: Error invoking remote method 'nomi:x': Error: y")).toBeNull();
    expect(ipcInvokeFailure(undefined)).toBeNull();
    expect(ipcInvokeFailure({ message: "Error invoking remote method 'x': Error: y" })).toBeNull();
  });

  it("readStructuredIpcFailure：结构化载体（StructuredIpcFailure / IpcResult / NomiErrorCode）优先于外壳文本", () => {
    const carrier = createStructuredIpcFailure({
      channel: "nomi:tasks:run",
      name: "AssetInvalidError",
      code: "EASSET",
      message: "NOMI_ERR::asset-invalid::图片不可用",
    });
    expect(readStructuredIpcFailure(carrier)).toEqual({
      channel: "nomi:tasks:run",
      name: "AssetInvalidError",
      code: "EASSET",
      errorCode: "asset-invalid",
      message: "NOMI_ERR::asset-invalid::图片不可用",
    });
    expect(readIpcFailureMessage(carrier)).toBe("NOMI_ERR::asset-invalid::图片不可用");

    const ipcResultErr = new IpcResultError("project-save-failed", { kind: "busy", message: "save busy" });
    expect(readStructuredIpcFailure(ipcResultErr)).toEqual({
      channel: "",
      name: "IpcResultError",
      code: "busy",
      message: "save busy",
    });
    expect(readStructuredIpcFailure({ ok: false, error: "save-locked", reason: { code: "EBUSY", message: "Error invoking remote method 'nomi:projects:save-async': Error: locked" } })).toEqual({
      channel: "",
      name: "IpcResultError",
      code: "EBUSY",
      message: "locked",
    });
    expect(ipcInvokeFailure("Error invoking remote method 'nomi:tasks:run': Error: NOMI_ERR::asset-invalid::bad ref")).toEqual({
      channel: "nomi:tasks:run",
      name: "Error",
      errorCode: "asset-invalid",
      message: "NOMI_ERR::asset-invalid::bad ref",
    });
  });
});

describe("withoutIpcInvokeWrapper：剥壳与它替掉的两份私有正则逐字相同", () => {
  // 被替掉的两份（classifyError 的 IPC_WRAPPER_PREFIX、storyboardFailureCopy 的 technicalDetail），原样抄来当对照。
  const classifyErrorBefore = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;
  const storyboardBefore = /^Error invoking remote method '[^']*': (?:Error: )?/;
  const inputs = [
    overInvoke("nomi:tasks:run", new Error("素材上传失败(HTTP 413)：(无详情)")),
    overInvoke("nomi:tasks:run", new Error("NOMI_VENDOR_ERR_B64::eyJ4IjoxfQ==:: upstream said no")),
    overInvoke("nomi:projects:delete", new Error("ProjectTrashFailedError[no-trash]: project folder was not moved")),
    overInvoke("nomi:projects:save-async", new WorkspaceManifestLockBusyError()),
    overInvoke("nomi:x", "host refused"),
    overInvoke("nomi:x", new Error("")),
    overInvoke("nomi:x", new Error("two\nlines")),
    "plain renderer error",
    "",
  ];

  it.each(inputs)("%j", (input) => {
    expect(withoutIpcInvokeWrapper(input)).toBe(input.replace(classifyErrorBefore, ""));
    expect(withoutIpcInvokeWrapper(input)).toBe(input.replace(storyboardBefore, ""));
  });
});

describe("代码里定义的类名：结构判据，不是名单", () => {
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

  /** 产品代码里写下的错误类名：错误类的类名、`this.name = '…'`、`error.name = '…'`、`Object.assign(new XError(…), { name: '…' })`。 */
  function namesWrittenInCode(): Map<string, string> {
    const patterns = [
      /\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+[\w.]*Error\b/g,
      /\bthis\.name\s*=\s*["'`]([^"'`\n]*)["'`]/g,
      /\b(?:error|err|e)\.name\s*=\s*["'`]([^"'`\n]*)["'`]/g,
      /Object\.assign\(\s*new\s+\w*Error\([^)]*\)\s*,\s*\{\s*name:\s*["'`]([^"'`\n]*)["'`]/g,
    ];
    const found = new Map<string, string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "dist") walk(full);
          continue;
        }
        if (!/\.(?:ts|tsx|mts|cts)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const pattern of patterns) {
          for (const match of text.matchAll(pattern)) found.set(match[1]!, path.relative(repoRoot, full).split(path.sep).join("/"));
        }
      }
    };
    for (const root of ["electron", "src"]) walk(path.join(repoRoot, root));
    return found;
  }

  it("全仓代码里写下的每一个错误类名都过这一条（类名不脱敏：形状判据漏掉一个，日志里那一类就只剩 Error）", () => {
    const names = namesWrittenInCode();
    expect(names.size).toBeGreaterThan(100);
    const rejected = [...names].filter(([name]) => !isCodeClassName(name)).map(([name, file]) => `${file}: ${name}`);
    expect(rejected, "错误类名写成大写开头的标识符（JS 类名的写法）").toEqual([]);
  });

  it("别的形状一律不是类名：凭据形状、项目名、一句话、路径、超长、非字符串", () => {
    for (const value of ["sk_live_0123456789abcdef", "ghp_0123456789abcdefABCDEF", "猫咪短片", "My Film", "Error: boom", "/Users/alice/x", "a.b", "", "A".repeat(65), 42, null]) {
      expect(isCodeClassName(value), String(value)).toBe(false);
    }
    expect(CODE_CLASS_NAME.test("AI_APICallError")).toBe(true);
  });
});
