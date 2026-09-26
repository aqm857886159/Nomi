import { describe, expect, it, vi } from "vitest";
import {
  installCrashHandlers,
  installProcessGoneHandlers,
  installUncaughtExceptionNoiseFilter,
  isUpstreamStreamTeardownError,
  startNativeCrashCapture,
} from "./crashLog";

/** 用户 2026-08-24 报的那一条，逐字照抄自 Windows 上的崩溃弹框。 */
function upstreamTeardownError(): Error {
  const error = Object.assign(
    new TypeError("Invalid state: ReadableStream is already closed"),
    { code: "ERR_INVALID_STATE" },
  );
  error.stack = [
    "TypeError [ERR_INVALID_STATE]: Invalid state: ReadableStream is already closed",
    "    at ReadableByteStreamController.close (node:internal/webstreams/readablestream:1155:13)",
    "    at node:internal/deps/undici/undici:1465:28",
    "    at node:internal/process/task_queues:140:7",
    "    at AsyncResource.runInAsyncScope (node:async_hooks:206:9)",
    "    at AsyncResource.runMicrotask (node:internal/process/task_queues:137:8)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
  ].join("\n");
  return error;
}

describe("isUpstreamStreamTeardownError", () => {
  it("认得 undici 响应流拆除竞态（全栈都在 Node 内部）", () => {
    expect(isUpstreamStreamTeardownError(upstreamTeardownError())).toBe(true);
  });

  it("栈里只要出现一帧我们自己的代码就不认——那是我们把流关了两次，真 bug 必须照旧弹框", () => {
    const error = upstreamTeardownError();
    error.stack = [
      "TypeError [ERR_INVALID_STATE]: Invalid state: ReadableStream is already closed",
      "    at ReadableByteStreamController.close (node:internal/webstreams/readablestream:1155:13)",
      "    at hardenedFetch (/Applications/Nomi.app/Contents/Resources/app.asar/dist-electron/hardenedFetch.js:204:31)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");
    expect(isUpstreamStreamTeardownError(error)).toBe(false);
  });

  it("别的 ERR_INVALID_STATE（不是流拆除）不认", () => {
    const error = Object.assign(new TypeError("Invalid state: something else"), {
      code: "ERR_INVALID_STATE",
    });
    error.stack = [
      "TypeError: Invalid state: something else",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");
    expect(isUpstreamStreamTeardownError(error)).toBe(false);
  });

  it("非 Error / 无 code / 无栈一律不认", () => {
    expect(isUpstreamStreamTeardownError("boom")).toBe(false);
    expect(isUpstreamStreamTeardownError(new Error("boom"))).toBe(false);
    const noStack = Object.assign(new Error("x"), { code: "ERR_INVALID_STATE", stack: "" });
    expect(isUpstreamStreamTeardownError(noStack)).toBe(false);
  });
});

describe("installUncaughtExceptionNoiseFilter", () => {
  function fakeTarget() {
    const listeners: Array<(error: Error, origin: string) => void> = [];
    const target = {
      on: vi.fn((_event: string, listener: (error: Error, origin: string) => void) => {
        listeners.push(listener);
        return target;
      }),
      removeListener: vi.fn((_event: string, listener: (error: Error, origin: string) => void) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
        return target;
      }),
      emit: vi.fn((_event: string, error: Error, origin: string) => {
        // 复刻 Electron：默认处理器只在「app 没挂自己的监听」时才弹框。
        for (const listener of [...listeners]) listener(error, origin);
        return true;
      }),
      listeners,
    };
    return target;
  }

  it("认得的那一类：落盘留证，且不回抛给 Electron 的默认弹框路径", () => {
    const target = fakeTarget();
    const record = vi.fn();
    installUncaughtExceptionNoiseFilter(target, record);

    target.listeners[0]?.(upstreamTeardownError(), "uncaughtException");

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][0]).toBe("uncaughtException:upstream-stream-teardown");
    expect(target.emit).not.toHaveBeenCalled();
  });

  it("其余异常原样交回默认路径：先摘掉自己再 emit（否则 Electron 的 listenerCount>1 判定会让它不弹框）", () => {
    const target = fakeTarget();
    const record = vi.fn();
    installUncaughtExceptionNoiseFilter(target, record);
    const ours = target.listeners[0]!;
    const boom = new Error("real crash");

    ours(boom, "uncaughtException");

    expect(record).not.toHaveBeenCalled();
    expect(target.emit).toHaveBeenCalledOnce();
    // emit 的那一刻自己必须已经不在监听列表里，否则 Electron 会以为 app 接管了、把框吞掉。
    expect(target.removeListener).toHaveBeenCalledBefore(target.emit as never);
    // 弹完要装回来，下一次照守（Electron 弹框后不 exit，进程继续跑）。
    expect(target.listeners).toContain(ours);
  });
});

describe("installCrashHandlers", () => {
  it("只监控未捕获异常，不接管 Node 的默认退出", () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const target = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return target;
      }),
    };
    const record = vi.fn();

    installCrashHandlers(target, record);

    expect([...listeners.keys()]).toEqual(["uncaughtExceptionMonitor"]);
    expect(listeners.has("uncaughtException")).toBe(false);
    expect(listeners.has("unhandledRejection")).toBe(false);
  });

  it("monitor 路径只同步落盘一次，不再写回坏掉的终端", () => {
    let monitor: ((error: Error, origin: string) => void) | undefined;
    const target = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        if (event === "uncaughtExceptionMonitor") {
          monitor = listener as (error: Error, origin: string) => void;
        }
        return target;
      }),
    };
    const record = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("write EIO"), { code: "EIO" });

    installCrashHandlers(target, record);
    monitor?.(error, "uncaughtException");

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith("uncaughtException", error);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("installProcessGoneHandlers", () => {
  function createTarget() {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const target = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
        return target;
      }),
    };
    return { target, listeners };
  }

  it("渲染进程死亡落盘：带上 reason/exitCode，否则日志等于没有", () => {
    const { target, listeners } = createTarget();
    const record = vi.fn();

    installProcessGoneHandlers(target, record);
    listeners.get("render-process-gone")?.({}, {}, { reason: "crashed", exitCode: 5 });

    expect(record).toHaveBeenCalledWith("render-process-gone", "reason=crashed exitCode=5");
  });

  it("子进程死亡落盘：GPU/utility 也要留证（辅助窗口的进程一样会死）", () => {
    const { target, listeners } = createTarget();
    const record = vi.fn();

    installProcessGoneHandlers(target, record);
    listeners.get("child-process-gone")?.({}, { type: "GPU", reason: "crashed", exitCode: 133 });

    expect(record).toHaveBeenCalledWith("child-process-gone", "type=GPU name=- reason=crashed exitCode=133");
  });

  it("装在 app 上而不是单个窗口上：两个事件都要挂", () => {
    const { target, listeners } = createTarget();
    installProcessGoneHandlers(target, vi.fn());
    expect([...listeners.keys()].sort()).toEqual(["child-process-gone", "render-process-gone"]);
  });
});

describe("startNativeCrashCapture", () => {
  it("开 Crashpad 且不外传（原生崩溃只有 minidump 能指认模块）", () => {
    const reporter = { start: vi.fn() };
    startNativeCrashCapture(reporter);
    expect(reporter.start).toHaveBeenCalledWith({ uploadToServer: false });
  });

  it("采集器起不来也不能拖垮启动", () => {
    const reporter = { start: vi.fn(() => { throw new Error("no crashpad"); }) };
    expect(() => startNativeCrashCapture(reporter)).not.toThrow();
  });
});
