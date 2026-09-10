import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ webContents: { fromId: () => null } }));

import { cancelComfyuiPrompt, computeOverallPercent, parsePreviewFrame } from "./comfyuiProgressSocket";

// ── 连接生命周期回归（open 超时必须终止挂起的 ws 并排程重连）──────────────────────────────
// 场景：ws 一直停在 CONNECTING（服务挂起/网络黑洞）。open 800ms 超时 settleReady(false)，
// 但旧实现不 close 这个僵尸 ws——没有 close 事件 → drop 不跑 → 不重连，且 ensureSocket
// 对后续 watcher 永远返回那份已 settle(false) 的 ready。修复：超时即 close()，借 close
// 事件走 drop → 仍有 watcher 时 3s 后重连。
const fakeSockets = vi.hoisted(() => {
  class FakeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    binaryType = "";
    closeCalled = false;
    readonly listeners = new Map<string, Array<(event?: unknown) => void>>();
    constructor(public url: string) { fakeSockets.instances.push(this); }
    addEventListener(type: string, listener: (event?: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }
    send(): void { /* 不关心 */ }
    close(): void {
      if (this.closeCalled) return;
      this.closeCalled = true;
      this.emit("close");
    }
    emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener({}); }
  }
  const fakeSockets = { instances: [] as Array<InstanceType<typeof FakeWebSocket>>, FakeWebSocket };
  return fakeSockets;
});

vi.mock("undici", () => ({ WebSocket: fakeSockets.FakeWebSocket }));
vi.mock("./systemProxy", () => ({ getAppDispatcher: async () => ({}) }));
vi.mock("./comfyui/clientSession", () => ({
  COMFYUI_CLIENT_FEATURE_FLAGS: { all: true },
  getComfyuiClientId: () => "test-client",
}));
vi.mock("./catalog/catalogStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("./catalog/catalogStore")>(),
  readCatalog: () => ({ vendors: [], models: [], mappings: [] }),
}));

import { watchComfyuiTask } from "./comfyuiProgressSocket";

describe("parsePreviewFrame（ComfyUI ws 二进制帧 [>I event][>I format][bytes]）", () => {
  const frame = (event: number, format: number, payload: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(event, 0);
    head.writeUInt32BE(format, 4);
    return Buffer.concat([head, payload]);
  };

  it("event=1(PREVIEW_IMAGE) + format 1/2 → jpeg/png", () => {
    const jpeg = parsePreviewFrame(frame(1, 1, Buffer.from("jpegbytes")));
    expect(jpeg?.mime).toBe("image/jpeg");
    expect(jpeg?.bytes.toString()).toBe("jpegbytes");
    expect(parsePreviewFrame(frame(1, 2, Buffer.from("x")))?.mime).toBe("image/png");
  });

  it("非预览事件（TEXT=3 等）/ 空载荷 / 残帧 → null", () => {
    expect(parsePreviewFrame(frame(3, 1, Buffer.from("text")))).toBeNull();
    expect(parsePreviewFrame(frame(1, 1, Buffer.alloc(0)))).toBeNull();
    expect(parsePreviewFrame(Buffer.from([0, 0, 0, 1]))).toBeNull();
  });

  it("超大帧（>1.5MB）拒收——IPC 别被灌爆", () => {
    expect(parsePreviewFrame(frame(1, 1, Buffer.alloc(2_000_000)))).toBeNull();
  });

  it("event=4 metadata 直接给出 prompt/node 归属，图片字节不含 metadata", () => {
    const metadata = Buffer.from(JSON.stringify({
      prompt_id: "123e4567-e89b-42d3-a456-426614174000",
      node_id: "9",
      image_type: "image/png",
    }));
    const head = Buffer.alloc(8);
    head.writeUInt32BE(4, 0);
    head.writeUInt32BE(metadata.length, 4);
    const parsed = parsePreviewFrame(Buffer.concat([head, metadata, Buffer.from("pngbytes")]));
    expect(parsed).toMatchObject({
      mime: "image/png",
      promptId: "123e4567-e89b-42d3-a456-426614174000",
      nodeId: "9",
    });
    expect(parsed?.bytes.toString()).toBe("pngbytes");
  });

  it("event=4 坏 metadata/超长声明安全拒收", () => {
    const broken = Buffer.alloc(12);
    broken.writeUInt32BE(4, 0);
    broken.writeUInt32BE(1000, 4);
    expect(parsePreviewFrame(broken)).toBeNull();
  });
});

describe("ComfyUI 安全取消", () => {
  it("新服只发原子定向 jobs cancel，不再双发 queue/interrupt", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cancelled: true })));
    await expect(cancelComfyuiPrompt("http://127.0.0.1:8188", "p1", fetchMock as typeof fetch))
      .resolves.toEqual({ ok: true, mode: "targeted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8188/api/jobs/p1/cancel");
  });

  it("jobs cancel 恒 200：cancelled:false 是「没什么可取消」，不许当成功报出去", async () => {
    // 官方这条对已结束/不认识的 id 也回 200，只是 body 里 cancelled=false。
    // 光看 res.ok 会让「点了取消、GPU 还在转」显示成已取消。
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cancelled: false })));
    await expect(cancelComfyuiPrompt("http://127.0.0.1:8188", "p9", fetchMock as typeof fetch))
      .resolves.toEqual({ ok: true, mode: "nothing-to-cancel" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("旧服 jobs 404 时同时发定向 /interrupt 与 /queue delete —— 光删排队停不掉正在跑的", async () => {
    // /queue {delete} 走 delete_queue_item，只摘排队项；正在执行的那个必须靠 /interrupt。
    // 定向 /interrupt 带 prompt_id，只在它正好是当前运行的那个时才打断，不误伤别人。
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).endsWith("/cancel") ? new Response("missing", { status: 404 }) : new Response("{}");
    });
    await expect(cancelComfyuiPrompt("http://127.0.0.1:8188", "p2", fetchMock as typeof fetch))
      .resolves.toEqual({ ok: true, mode: "legacy" });
    expect(urls[0]).toBe("http://127.0.0.1:8188/api/jobs/p2/cancel");
    expect(urls.slice(1).sort()).toEqual([
      "http://127.0.0.1:8188/interrupt",
      "http://127.0.0.1:8188/queue",
    ]);
    const bodies = fetchMock.mock.calls.slice(1).map((c) => JSON.parse(String(c[1]?.body)));
    expect(bodies).toEqual(expect.arrayContaining([{ prompt_id: "p2" }, { delete: ["p2"] }]));
  });

  it("鉴权/服务错误不伪装成旧服并发第二个请求", async () => {
    const fetchMock = vi.fn(async () => new Response("denied", { status: 401 }));
    await expect(cancelComfyuiPrompt("http://127.0.0.1:8188", "p3", fetchMock as typeof fetch))
      .resolves.toEqual({ ok: false, mode: "failed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("computeOverallPercent（已开跑节点-1 + 当前节点比率 / 总数）", () => {
  it("常规推进单调不倒退", () => {
    expect(computeOverallPercent(1, 0, 10)).toBe(0);
    expect(computeOverallPercent(1, 0.5, 10)).toBe(5);
    expect(computeOverallPercent(3, 0.5, 10)).toBe(25);
    expect(computeOverallPercent(10, 1, 10)).toBe(100);
  });
  it("防御：总数 0 / 比率越界 → 不 NaN 不越界", () => {
    expect(computeOverallPercent(3, 0.5, 0)).toBe(0);
    expect(computeOverallPercent(2, 5, 4)).toBe(50);
    expect(computeOverallPercent(0, -1, 4)).toBe(0);
  });
});

describe("终态事件口径（真服务器实测：全缓存那轮不发 executing）", () => {
  it("三个官方终态全认（照抄 ComfyUI jobs.py:231 的 execution_end 口径）", async () => {
    const { isComfyuiTerminalEvent, COMFYUI_TERMINAL_EVENTS } = await import("./comfyuiProgressSocket");
    expect([...COMFYUI_TERMINAL_EVENTS].sort()).toEqual(["execution_error", "execution_interrupted", "execution_success"]);
    for (const type of COMFYUI_TERMINAL_EVENTS) expect(isComfyuiTerminalEvent(type)).toBe(true);
  });

  it("进行中/无关事件不误判成终态（否则进度半路就把注册表清了）", async () => {
    const { isComfyuiTerminalEvent } = await import("./comfyuiProgressSocket");
    for (const type of ["executing", "progress", "progress_state", "execution_start", "execution_cached", "executed", "status", "", null, undefined, 42]) {
      expect(isComfyuiTerminalEvent(type), String(type)).toBe(false);
    }
  });

});

describe("ws 连接生命周期（open 超时 → 终止僵尸连接并重连）", () => {
  it("open 800ms 超时后 close 挂起的 ws；仍有 watcher → 3s 后重连一次", async () => {
    vi.useFakeTimers();
    try {
      const watch = watchComfyuiTask({ promptId: "p-timeout-1", nodeId: "n1", taskKind: "text_to_image" }, 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(fakeSockets.instances.length).toBe(1);
      const first = fakeSockets.instances[0];
      expect(first.closeCalled).toBe(false);

      // 800ms open 超时：必须 close 僵尸连接（借 close 事件走 drop → 排程重连）。
      await vi.advanceTimersByTimeAsync(800);
      expect(first.closeCalled).toBe(true);
      await watch;

      // drop 看到仍有 watcher → 3s 后重连（修复前：无 close 事件，永远只有第一个实例）。
      await vi.advanceTimersByTimeAsync(3000);
      expect(fakeSockets.instances.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

