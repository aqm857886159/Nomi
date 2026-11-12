/**
 * 出站策略 owner 的判据测试（零额度：全部用注入的 DNS 夹具，不发一个真实包）。
 *
 * 每一条都对应一个真实环境里撞到的事实，或对应一条**不许因为放宽而丢掉**的安全边界。
 * 「解析结果 × 探测状态」的整张矩阵与「提交放行 ⇒ 取回必过」的不变量在 `outboundAddressMatrix.test.ts`；
 * 这里守的是判据的零件：地址分类、探针证据、当场重探、拒绝子码。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeOutboundDestination,
  classifyOutboundAddresses,
  coarseAddressLabel,
  lastOutboundEnvironment,
  readOutboundEnvironment,
  setOutboundRefusalReporter,
  setSyntheticResolverProbeForTests,
  type OutboundRefusalFacts,
} from "./networkOutboundPolicy";
import { isPrivateHost } from "./networkHostPolicy";

afterEach(() => {
  setSyntheticResolverProbeForTests(null);
  setOutboundRefusalReporter(null);
  vi.stubEnv("LAB_ALLOW_LOCALHOST", undefined);
});

describe("地址分类：任何一个落在保留段即整体拒绝", () => {
  it.each([
    ["回环", "127.0.0.1", 4],
    ["RFC 1918 A", "10.1.2.3", 4],
    ["RFC 1918 B", "172.16.5.5", 4],
    ["RFC 1918 C", "192.168.1.1", 4],
    ["云元数据", "169.254.169.254", 4],
    ["CGNAT", "100.64.0.1", 4],
    ["RFC 2544", "198.18.0.140", 4],
    ["IPv6 回环", "::1", 6],
    ["IPv6 ULA", "fd00::1", 6],
    ["IPv6 2001:2::/48", "2001:2::5", 6],
  ] as const)("拒绝：%s", (_label, address, family) => {
    expect(classifyOutboundAddresses({ addresses: [{ address, family }] })).toEqual({
      allowed: false,
      reason: "private-address",
      observedAddress: address,
    });
  });

  it("多解析结果里只要有一个是私网就整体拒绝（不许挑一个能过的用）", () => {
    expect(
      classifyOutboundAddresses({
        addresses: [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).toMatchObject({ allowed: false, observedAddress: "127.0.0.1" });
  });

  it("解析不出地址是终态拒绝，不是「放行看看」", () => {
    expect(classifyOutboundAddresses({ addresses: [] })).toEqual({ allowed: false, reason: "unresolvable", observedAddress: "" });
  });

  it("公网地址照常放行（v4 / v6）", () => {
    expect(classifyOutboundAddresses({ addresses: [{ address: "93.184.216.34", family: 4 }] })).toEqual({ allowed: true });
    expect(classifyOutboundAddresses({ addresses: [{ address: "2606:4700::1111", family: 6 }] })).toEqual({ allowed: true });
  });
});

describe("合成解析器探测：随机不存在的名字被答成任何保留段地址 = 证据（v4 / v6 一视同仁）", () => {
  it.each([
    ["IPv4 198.18/15", "198.18.0.7", 4],
    ["IPv6 2001:2::/48", "2001:2::1:5", 6],
    ["IPv6 fc00::/7", "fdfe:dcba:9876::2", 6],
    ["IPv4 RFC 1918", "10.10.0.3", 4],
  ] as const)("%s → 确认", async (_label, address, family) => {
    const probed: string[] = [];
    setSyntheticResolverProbeForTests(async (hostname) => {
      probed.push(hostname);
      return [{ address, family }];
    });
    await expect(readOutboundEnvironment()).resolves.toEqual({ syntheticResolver: true, syntheticSample: address });
    expect(probed[0]).toMatch(/^nomi-fakeip-probe-[a-z0-9]+\./);
  });

  it("答成公网地址（运营商 NXDOMAIN 劫持到落地页）不算证据", async () => {
    setSyntheticResolverProbeForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(readOutboundEnvironment()).resolves.toEqual({ syntheticResolver: false, syntheticSample: "" });
  });

  it("探针只用真实 TLD —— .invalid/.test/.example 会被系统本地答成 NXDOMAIN，根本到不了代理", async () => {
    // 2026-09-07 真机实测：用 `.invalid` 探测时，一台确实开着 fake-ip 的机器上探针恒 ENOTFOUND。
    const probed: string[] = [];
    setSyntheticResolverProbeForTests(async (hostname) => {
      probed.push(hostname);
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    await readOutboundEnvironment();
    expect(probed.length).toBeGreaterThan(0);
    for (const hostname of probed) {
      expect(hostname).not.toMatch(/\.(invalid|test|example|localhost|local)$/);
      expect(hostname).toMatch(/\.(com|net)$/);
    }
  });

  it("第一个 TLD 解析失败时继续问下一个", async () => {
    let call = 0;
    setSyntheticResolverProbeForTests(async () => {
      call += 1;
      if (call === 1) throw Object.assign(new Error("EAI_AGAIN"), { code: "EAI_AGAIN" });
      return [{ address: "198.18.9.9", family: 4 }];
    });
    await expect(readOutboundEnvironment()).resolves.toEqual({ syntheticResolver: true, syntheticSample: "198.18.9.9" });
  });

  it("正常解析器（NXDOMAIN）→ 没有合成解析器", async () => {
    setSyntheticResolverProbeForTests(async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    await expect(readOutboundEnvironment()).resolves.toEqual({ syntheticResolver: false, syntheticSample: "" });
  });

  it("缓存读只探一次：提交那一刻与取回那一刻读到的是同一份判定", async () => {
    let calls = 0;
    setSyntheticResolverProbeForTests(async () => {
      calls += 1;
      return [{ address: "198.18.0.7", family: 4 }];
    });
    await Promise.all([readOutboundEnvironment(), readOutboundEnvironment()]);
    await readOutboundEnvironment();
    expect(calls).toBe(1);
  });
});

describe("当场重探（fresh）：先开 Nomi 后开代理也不会一直判成「没代理」", () => {
  it("fresh 读不用缓存，结果写回缓存（之后的缓存读与设置页那一行都是新值）", async () => {
    let proxyOn = false;
    setSyntheticResolverProbeForTests(async () => {
      if (!proxyOn) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return [{ address: "198.18.0.7", family: 4 }];
    });
    await expect(readOutboundEnvironment()).resolves.toMatchObject({ syntheticResolver: false });
    proxyOn = true;
    await expect(readOutboundEnvironment()).resolves.toMatchObject({ syntheticResolver: false });
    await expect(readOutboundEnvironment({ fresh: true })).resolves.toMatchObject({ syntheticResolver: true });
    await expect(readOutboundEnvironment()).resolves.toMatchObject({ syntheticResolver: true });
    expect(lastOutboundEnvironment()).toMatchObject({ syntheticResolver: true });
  });

  it("并发的重探共用同一次探测（一批取回同时撞上不会打出一串探针）", async () => {
    let calls = 0;
    setSyntheticResolverProbeForTests(async () => {
      calls += 1;
      return [{ address: "198.18.0.7", family: 4 }];
    });
    await Promise.all([
      readOutboundEnvironment({ fresh: true }),
      readOutboundEnvironment({ fresh: true }),
      readOutboundEnvironment({ fresh: true }),
    ]);
    expect(calls).toBe(1);
  });
});

describe("拒绝子码（遥测）：只有枚举，没有地址和域名", () => {
  it("取回侧按地址拒：带阶段、原因、路由、地址族与类别、探测状态", async () => {
    const reported: OutboundRefusalFacts[] = [];
    setOutboundRefusalReporter((facts) => reported.push(facts));
    const result = await authorizeOutboundDestination({
      url: new URL("https://cdn.vendor.example/v.mp4"),
      route: "direct",
      stage: "retrieval",
      readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
      resolve: async () => [{ address: "fd00::7", family: 6 }],
    });
    expect(result).toMatchObject({ allowed: false, reason: "private-address" });
    expect(reported).toEqual([
      {
        stage: "retrieval",
        reason: "private-address",
        route: "direct",
        addressFamily: "6",
        addressClass: "unique-local-v6",
        syntheticResolver: false,
        probe: "unconfirmed-after-reprobe",
      },
    ]);
    const serialized = JSON.stringify(reported);
    expect(serialized).not.toContain("vendor.example");
    expect(serialized).not.toContain("fd00");
  });

  it("提交侧名字层拒：URL 里直接写内网 IP 且不是保存的接入地址", async () => {
    const reported: OutboundRefusalFacts[] = [];
    setOutboundRefusalReporter((facts) => reported.push(facts));
    await authorizeOutboundDestination({
      url: new URL("http://192.168.1.20:9000/upload"),
      route: "proxy",
      stage: "submit",
      proxyKind: "provider",
      readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
      resolve: async () => [],
    });
    expect(reported).toEqual([
      {
        stage: "submit",
        reason: "private-host",
        route: "provider-proxy",
        addressFamily: "4",
        addressClass: "rfc1918",
        syntheticResolver: false,
        probe: "not-probed",
      },
    ]);
    expect(JSON.stringify(reported)).not.toContain("192.168");
  });

  it("报告器抛错不改判定", async () => {
    setOutboundRefusalReporter(() => {
      throw new Error("telemetry down");
    });
    await expect(
      authorizeOutboundDestination({
        url: new URL("http://127.0.0.1:1/x"),
        route: "direct",
        stage: "retrieval",
        readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
        resolve: async () => [],
      }),
    ).resolves.toMatchObject({ allowed: false, reason: "private-host" });
  });
});

describe("私网分类器没有逃生口", () => {
  it("LAB_ALLOW_LOCALHOST=1 不再让 127.0.0.1 变成公网", () => {
    vi.stubEnv("LAB_ALLOW_LOCALHOST", "1");
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("localhost")).toBe(true);
  });
});

describe("辅助判据", () => {
  it("错误文案里的地址只到 /16 粒度，不泄露完整内网地址", () => {
    expect(coarseAddressLabel("198.18.0.140")).toBe("198.18.x.x");
    expect(coarseAddressLabel("192.168.31.42")).toBe("192.168.x.x");
  });
});
