import { describe, expect, it } from "vitest";

import { describeOutboundFailure, handOffToNetwork, isTransportLevelFailure, observeSubmissionHandoffs, outboundRequestWasNeverWritten } from "./outboundDispatchEvidence";

/**
 * undici 的 SocketError 形状。字节计数**刻意带上**：它们是整条连接累计的，
 * keep-alive 复用时永远不是 0——判据不许再去看它们（第一版看了，CI 当场证伪）。
 */
function socketError(message: string, bytesWritten = 4096, bytesRead = 2048) {
  return Object.assign(new Error(message), {
    name: "SocketError",
    code: "UND_ERR_SOCKET",
    socket: { bytesWritten, bytesRead },
  });
}

/** `fetch()` 抛出来的真实形状：外壳恒为 `TypeError: fetch failed`，真相在 cause 里。 */
function fetchFailed(cause: unknown) {
  return Object.assign(new TypeError("fetch failed"), { cause });
}

describe("outboundRequestWasNeverWritten", () => {
  it("UND_ERR_SOCKET（对面关了连接）= 分不清是旧连接还是写出去后被重置 ⇒ unknown（2026-10-02 修：此前判成没写出去，重复下单）", () => {
    expect(outboundRequestWasNeverWritten(fetchFailed(socketError("other side closed")))).toBe(false);
  });

  it("不管字节计数是多少都是 unknown：计数是整条连接累计的，说明不了这一次请求", () => {
    expect(outboundRequestWasNeverWritten(fetchFailed(socketError("other side closed", 4096, 2048)))).toBe(false);
    expect(outboundRequestWasNeverWritten(fetchFailed(socketError("other side closed", 0, 0)))).toBe(false);
  });

  it("连接被重置 / socket hang up / 发出后被取消 ⇒ unknown", () => {
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", syscall: "read" })))).toBe(false);
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })))).toBe(false);
    expect(outboundRequestWasNeverWritten(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))).toBe(false);
  });

  it("TLS 握手前就失败（证书 / 握手前被复位）= 可证明没写出去", () => {
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("self signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" })))).toBe(true);
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("Client network socket disconnected before secure TLS connection was established"), { code: "ECONNRESET" })))).toBe(true);
  });

  it("建连阶段失败（connect / DNS / 建连超时）= 可证明没写出去", () => {
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED", syscall: "connect" })))).toBe(true);
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND", syscall: "getaddrinfo" })))).toBe(true);
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" })))).toBe(true);
  });

  it("响应头超时 = 请求已经写出去了，只是没等到回音 ⇒ unknown", () => {
    expect(outboundRequestWasNeverWritten(fetchFailed(Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" })))).toBe(false);
  });

  it("读响应体读一半断（已经收到过响应头）⇒ unknown", () => {
    expect(outboundRequestWasNeverWritten(Object.assign(new Error("terminated"), { code: "UND_ERR_BODY_TIMEOUT" }))).toBe(false);
  });

  it("没有 cause、非 Error、成环的 cause 都不会把它判成 not_written 或卡死", () => {
    expect(outboundRequestWasNeverWritten(new TypeError("fetch failed"))).toBe(false);
    expect(outboundRequestWasNeverWritten("fetch failed")).toBe(false);
    expect(outboundRequestWasNeverWritten(null)).toBe(false);
    const looped: { cause?: unknown; code?: string } = {};
    looped.cause = looped;
    expect(outboundRequestWasNeverWritten(looped)).toBe(false);
  });

  it("isTransportLevelFailure：连接层失败才值得（在供应商支持幂等时）重发；HTTP 答复与用户取消不算", () => {
    expect(isTransportLevelFailure(fetchFailed(socketError("other side closed")))).toBe(true);
    expect(isTransportLevelFailure(fetchFailed(Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" })))).toBe(true);
    expect(isTransportLevelFailure(new Error("Provider request failed (HTTP 500) at x"))).toBe(false);
    expect(isTransportLevelFailure(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
  });

  it("describeOutboundFailure 把 cause 链摊平，不再只剩一句 fetch failed", () => {
    const described = describeOutboundFailure(fetchFailed(socketError("other side closed", 0, 0)));
    expect(described).toBe("TypeError: fetch failed ← SocketError UND_ERR_SOCKET: other side closed");
  });

  it("describeOutboundFailure 只取 name/code/message，不带 socket 地址端口进日志", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED", syscall: "connect", address: "10.0.0.9", port: 443,
    });
    const described = describeOutboundFailure(fetchFailed(cause));
    expect(described).not.toContain("10.0.0.9");
    expect(described).not.toContain("443");
    expect(described).toContain("ECONNREFUSED");
  });
});

/**
 * 按派发记账（L-claim，2026-10-06）。这一组测的是**类**的边界：「确定没离开本机」只在
 * 「一个可能花钱的请求都没交给网络 / 交出去的全在连上之前就失败」时成立；其余（交出去了、结果不明）一律 null。
 */
describe("observeSubmissionHandoffs", () => {
  const connectRefused = () => fetchFailed(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED", syscall: "connect" }));
  const handOff = (init: RequestInit, outcome: () => Promise<unknown>, url = "https://api.vendor.test/v1/x") =>
    handOffToNetwork(url, init, outcome);

  it("在本机就失败、一个请求都没交给网络 ⇒ never_reached_network（不管错误长什么样）", async () => {
    const result = await observeSubmissionHandoffs("app-fetch", async () => { throw new Error("anything local"); });
    expect(result).toMatchObject({ ok: false, notDispatched: "never_reached_network" });
  });

  it("交出去的那一笔在连上之前就失败 ⇒ connect_failed", async () => {
    const result = await observeSubmissionHandoffs("app-fetch", () => handOff({ method: "POST", body: "{}" }, async () => { throw connectRefused(); }));
    expect(result).toMatchObject({ ok: false, notDispatched: "connect_failed" });
  });

  it("交出去的那一笔写出去之后才断（对面关了连接）⇒ null（结果未知）", async () => {
    const result = await observeSubmissionHandoffs("app-fetch", () => handOff({ method: "POST", body: "{}" }, async () => { throw fetchFailed(socketError("other side closed")); }));
    expect(result).toMatchObject({ ok: false, notDispatched: null });
  });

  it("先有一笔拿到了回复（写出去了），后面在本机被拦 ⇒ null：防双扣最要紧的一格", async () => {
    const result = await observeSubmissionHandoffs("app-fetch", async () => {
      await handOff({ method: "POST", body: "{}" }, async () => "response");
      throw new Error("second step refused locally");
    });
    expect(result).toMatchObject({ ok: false, notDispatched: null });
  });

  it("不带凭据、没有 query、没有请求体的 GET（官方备用域探测那种）不算可能花钱；带了任何一样就算", async () => {
    const probeThenLocal = await observeSubmissionHandoffs("app-fetch", async () => {
      await handOff({ method: "GET" }, async () => "probe answered");
      throw new Error("refused locally");
    });
    expect(probeThenLocal).toMatchObject({ notDispatched: "never_reached_network" });
    for (const init of [{ method: "GET", headers: { "x-api-key": "k" } }, { method: "GET", body: undefined }] as RequestInit[]) {
      const url = init.headers ? "https://api.vendor.test/v1/x" : "https://api.vendor.test/v1/x?key=k";
      const result = await observeSubmissionHandoffs("app-fetch", async () => {
        await handOff(init, async () => "answered", url);
        throw new Error("refused locally");
      });
      expect(result, JSON.stringify(init)).toMatchObject({ notDispatched: null });
    }
  });

  it("执行器没声明走 appFetch ⇒ 账本不作数，只认 cause 链证据（测试替身 / 别的传输不会被误判成没发出）", async () => {
    expect(await observeSubmissionHandoffs(undefined, async () => { throw new Error("pure function provider"); })).toMatchObject({ notDispatched: null });
    expect(await observeSubmissionHandoffs(undefined, async () => { throw connectRefused(); })).toMatchObject({ notDispatched: "connect_failed" });
  });

  it("不在任何派发里的请求不记账；嵌套派发时内层交出的请求外层也看得见", async () => {
    await handOff({ method: "POST", body: "{}" }, async () => "outside any dispatch");
    const outer = await observeSubmissionHandoffs("app-fetch", async () => {
      await observeSubmissionHandoffs("app-fetch", () => handOff({ method: "POST", body: "{}" }, async () => "inner sent"));
      throw new Error("outer refused locally");
    });
    expect(outer).toMatchObject({ notDispatched: null });
  });

  it("成功原样返回", async () => {
    expect(await observeSubmissionHandoffs("app-fetch", async () => 42)).toEqual({ ok: true, value: 42 });
  });
});
