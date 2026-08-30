import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
} from "quickjs-emscripten";

const SANDBOX_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const SANDBOX_STACK_LIMIT_BYTES = 1024 * 1024;
const HOST_ERROR_MARKER = "__NOMI_CAPABILITY_ERROR__";

type HostRequest = (init: Record<string, unknown>) => Promise<unknown>;
type HostSaveFile = (input: { bytes: number[]; ext: string; contentType: string }) => Promise<string>;

export type CustomCallSandboxInput = {
  script: string;
  globals: Record<string, unknown>;
  signal: AbortSignal;
  deadlineAt: number;
  request: HostRequest;
  saveFile: HostSaveFile;
  redact: (value: string) => string;
};

export class CustomCallSandboxError extends Error {
  readonly kind: "syntax" | "runtime" | "timeout" | "cancelled";
  readonly causeError?: unknown;

  constructor(
    kind: CustomCallSandboxError["kind"],
    message: string,
    causeError?: unknown,
  ) {
    super(message);
    this.name = "CustomCallSandboxError";
    this.kind = kind;
    this.causeError = causeError;
  }
}

function guestErrorMessage(value: unknown): string {
  if (value && typeof value === "object") {
    const error = value as { name?: unknown; message?: unknown; stack?: unknown };
    const name = typeof error.name === "string" ? error.name : "Error";
    const message = typeof error.message === "string" ? error.message : String(value);
    return `${name}: ${message}`;
  }
  return String(value);
}

function guestProgram(globals: Record<string, unknown>, script: string): string {
  const serializedGlobals = JSON.stringify(JSON.stringify(globals));
  return `
"use strict";
const __nomiInput = JSON.parse(${serializedGlobals});
const { prompt, taskKind, modeId, params, references, model, baseUrl, apiKey, config } = __nomiInput;
const __nomiJoinUrl = (path) => {
  if (/^https?:\\/\\//i.test(String(path || ""))) return String(path || "");
  const base = String(baseUrl || "").replace(/\\/+$/, "");
  const part = String(path || "");
  return base + (part.startsWith("/") ? "" : "/") + part;
};
const __nomiUnwrap = (wire) => {
  const envelope = JSON.parse(wire);
  if (!envelope.ok) throw new Error(${JSON.stringify(HOST_ERROR_MARKER)} + envelope.errorId + ":" + envelope.message);
  return envelope.value;
};
class NomiFormData {
  constructor() {
    Object.defineProperty(this, "__nomiFormData", { value: true, enumerable: true });
    this.entries = [];
  }
  append(name, value, filename) {
    let normalized;
    if (value instanceof ArrayBuffer) value = new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      normalized = { kind: "bytes", bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    } else {
      normalized = { kind: "string", value: String(value) };
    }
    this.entries.push({ name: String(name), value: normalized, ...(filename == null ? {} : { filename: String(filename) }) });
  }
  set(name, value, filename) {
    const key = String(name);
    this.entries = this.entries.filter((entry) => entry.name !== key);
    this.append(key, value, filename);
  }
  get(name) {
    const entry = this.entries.find((item) => item.name === String(name));
    if (!entry) return null;
    return entry.value.kind === "bytes" ? new Uint8Array(entry.value.bytes) : entry.value.value;
  }
  *keys() { for (const entry of this.entries) yield entry.name; }
  *[Symbol.iterator]() { for (const entry of this.entries) yield [entry.name, this.get(entry.name)]; }
}
Object.defineProperty(globalThis, "FormData", { value: NomiFormData, writable: false, configurable: false });
const request = async (init) => __nomiUnwrap(await __nomiHostRequest(JSON.stringify(init || {})));
const http = Object.freeze({
  url: (path) => __nomiJoinUrl(path),
  post: (path, body, opts) => request({
    method: "POST", url: path, body,
    query: opts?.query,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey, ...(opts?.headers || {}) },
  }),
  get: (path, opts) => request({
    method: "GET", url: path, query: opts?.query,
    headers: { Authorization: "Bearer " + apiKey, ...(opts?.headers || {}) },
  }),
});
const sleep = async (ms) => { __nomiUnwrap(await __nomiHostSleep(JSON.stringify({ ms }))); };
const poll = async (fn, extract, opts) => {
  const intervalMs = Math.max(500, Number(opts?.intervalMs) || 2500);
  const timeoutMs = Math.max(1000, Number(opts?.timeoutMs) || 10 * 60 * 1000);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = extract(await fn());
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() >= deadline) throw new Error("轮询超时（" + Math.round(timeoutMs / 1000) + "s）——上游任务未在限时内完成");
    await sleep(intervalMs);
  }
};
const saveFile = async (bytes, ext, contentType) => {
  let view;
  if (bytes instanceof ArrayBuffer) view = new Uint8Array(bytes);
  else if (ArrayBuffer.isView(bytes)) view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  else if (Array.isArray(bytes)) view = Uint8Array.from(bytes);
  else throw new TypeError("saveFile bytes 必须是 ArrayBuffer、Uint8Array 或数字数组");
  return __nomiUnwrap(await __nomiHostSaveFile(JSON.stringify({
    bytes: Array.from(view),
    ext: typeof ext === "string" ? ext : "bin",
    contentType: typeof contentType === "string" ? contentType : "application/octet-stream",
  })));
};
const signal = Object.freeze({ get aborted() { return __nomiHostSignalAborted(); } });
globalThis.__nomiDone = false;
globalThis.__nomiResult = undefined;
globalThis.__nomiError = undefined;
(async () => {
${script}
})().then(
  (value) => {
    try {
      globalThis.__nomiResult = JSON.stringify({ ok: true, value });
    } catch (error) {
      globalThis.__nomiError = JSON.stringify({ name: "TypeError", message: "脚本返回值无法序列化：" + String(error?.message || error) });
    }
    globalThis.__nomiDone = true;
  },
  (error) => {
    globalThis.__nomiError = JSON.stringify({
      name: String(error?.name || "Error"),
      message: String(error?.message || error),
    });
    globalThis.__nomiDone = true;
  },
);
`;
}

function setGlobalFunction(context: QuickJSContext, name: string, handle: QuickJSHandle): void {
  handle.consume((fn) => context.setProp(context.global, name, fn));
}

function readGlobal(context: QuickJSContext, name: string): unknown {
  const handle = context.getProp(context.global, name);
  try {
    return context.dump(handle);
  } finally {
    handle.dispose();
  }
}

function classifyFailure(input: CustomCallSandboxInput, message: string, causeError?: unknown): CustomCallSandboxError {
  const reason = input.signal.reason;
  if ((reason instanceof Error && reason.name === "TimeoutError") || Date.now() >= input.deadlineAt) {
    return new CustomCallSandboxError("timeout", "自定义调用脚本超时", causeError ?? reason);
  }
  if (input.signal.aborted) return new CustomCallSandboxError("cancelled", "自定义调用已取消", causeError);
  const match = message.match(new RegExp(`${HOST_ERROR_MARKER}([^:]+):`));
  return new CustomCallSandboxError("runtime", input.redact(message.replace(match?.[0] || "", "")), causeError);
}

/**
 * 在独立 QuickJS/WASM realm 中运行 renderer 提交的脚本。QuickJS 里没有 Node、fetch、DOM 或
 * Electron 全局；脚本只能通过下方显式桥接的 capability 与主进程交互。
 */
export async function runCustomCallSandbox(input: CustomCallSandboxInput): Promise<unknown> {
  let context: QuickJSContext | undefined;
  let programHandle: QuickJSHandle | undefined;
  const pendingHostPromises = new Set<QuickJSDeferredPromise>();
  const hostErrors = new Map<string, unknown>();
  let nextErrorId = 0;
  const envelope = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      return JSON.stringify({ ok: true, value: await run() });
    } catch (error) {
      const errorId = String(++nextErrorId);
      hostErrors.set(errorId, error);
      const message = input.redact(error instanceof Error ? error.message : String(error));
      return JSON.stringify({ ok: false, errorId, message });
    }
  };

  try {
    context = (await getQuickJS()).newContext();
    context.runtime.setMemoryLimit(SANDBOX_MEMORY_LIMIT_BYTES);
    context.runtime.setMaxStackSize(SANDBOX_STACK_LIMIT_BYTES);
    context.runtime.setInterruptHandler(() => input.signal.aborted || Date.now() >= input.deadlineAt);

    const hostPromise = (run: () => Promise<string>): QuickJSHandle => {
      const deferred = context!.newPromise();
      pendingHostPromises.add(deferred);
      void run()
        .then((wire) => {
          if (!context?.alive || !deferred.alive) return;
          context.newString(wire).consume((value) => deferred.resolve(value));
        })
        .catch((error) => {
          if (!context?.alive || !deferred.alive) return;
          context.newError(input.redact(error instanceof Error ? error.message : String(error)))
            .consume((value) => deferred.reject(value));
        })
        .finally(() => pendingHostPromises.delete(deferred));
      return deferred.handle;
    };

    setGlobalFunction(
      context,
      "__nomiHostRequest",
      context.newFunction("__nomiHostRequest", (payload) => {
        const wire = context!.getString(payload);
        return hostPromise(() =>
          envelope(async () => {
            const parsed = JSON.parse(wire) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request 参数必须是对象");
            return input.request(parsed as Record<string, unknown>);
          }),
        );
      }),
    );
    setGlobalFunction(
      context,
      "__nomiHostSleep",
      context.newFunction("__nomiHostSleep", (payload) => {
        const wire = context!.getString(payload);
        return hostPromise(() =>
          envelope(async () => {
            const parsed = JSON.parse(wire) as { ms?: unknown };
            const ms = Math.max(0, Number(parsed.ms) || 0);
            let abort: (() => void) | undefined;
            try {
              await new Promise<void>((resolve, reject) => {
                if (input.signal.aborted) return reject(input.signal.reason || new Error("aborted"));
                const timer = setTimeout(resolve, ms);
                abort = () => {
                  clearTimeout(timer);
                  reject(input.signal.reason || new Error("aborted"));
                };
                input.signal.addEventListener("abort", abort, { once: true });
              });
            } finally {
              if (abort) input.signal.removeEventListener("abort", abort);
            }
            return null;
          }),
        );
      }),
    );
    setGlobalFunction(
      context,
      "__nomiHostSaveFile",
      context.newFunction("__nomiHostSaveFile", (payload) => {
        const wire = context!.getString(payload);
        return hostPromise(() =>
          envelope(async () => {
            const parsed = JSON.parse(wire) as { bytes?: unknown; ext?: unknown; contentType?: unknown };
            if (!Array.isArray(parsed.bytes) || !parsed.bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
              throw new Error("saveFile bytes 无效");
            }
            return input.saveFile({
              bytes: parsed.bytes as number[],
              ext: typeof parsed.ext === "string" ? parsed.ext : "bin",
              contentType: typeof parsed.contentType === "string" ? parsed.contentType : "application/octet-stream",
            });
          }),
        );
      }),
    );
    setGlobalFunction(
      context,
      "__nomiHostSignalAborted",
      context.newFunction("__nomiHostSignalAborted", () => (input.signal.aborted ? context!.true : context!.false)),
    );

    const evaluated = context.evalCode(guestProgram(input.globals, input.script), "custom-call.js");
    if (evaluated.error) {
      const message = guestErrorMessage(context.dump(evaluated.error));
      evaluated.error.dispose();
      if (/SyntaxError/i.test(message)) {
        throw new CustomCallSandboxError("syntax", input.redact(message));
      }
      throw classifyFailure(input, message);
    }
    programHandle = evaluated.value;

    while (readGlobal(context, "__nomiDone") !== true) {
      if (input.signal.aborted || Date.now() >= input.deadlineAt) throw classifyFailure(input, "interrupted");
      if (!context.runtime.hasPendingJob()) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      const jobs = await Promise.resolve(context.runtime.executePendingJobs());
      if (jobs.error) {
        const message = guestErrorMessage(context.dump(jobs.error));
        jobs.error.dispose();
        throw classifyFailure(input, message);
      }
    }

    const guestError = readGlobal(context, "__nomiError");
    if (typeof guestError === "string" && guestError) {
      let message = guestError;
      try {
        const parsed = JSON.parse(guestError) as { name?: unknown; message?: unknown };
        message = `${String(parsed.name || "Error")}: ${String(parsed.message || "")}`;
      } catch {
        // Keep the raw guest error when a hostile script overwrote our diagnostic slot.
      }
      const hostErrorId = message.match(new RegExp(`${HOST_ERROR_MARKER}([^:]+):`))?.[1];
      throw classifyFailure(input, message, hostErrorId ? hostErrors.get(hostErrorId) : undefined);
    }

    const resultWire = readGlobal(context, "__nomiResult");
    if (typeof resultWire !== "string") throw new CustomCallSandboxError("runtime", "脚本没有返回可读取的结果");
    const parsed = JSON.parse(resultWire) as { ok?: unknown; value?: unknown };
    return parsed.value;
  } catch (error) {
    if (error instanceof CustomCallSandboxError) throw error;
    throw classifyFailure(input, guestErrorMessage(error), error);
  } finally {
    programHandle?.dispose();
    for (const deferred of pendingHostPromises) deferred.dispose();
    pendingHostPromises.clear();
    context?.dispose();
  }
}
