/**
 * 出站策略 owner 的判据测试（零额度：全部用注入的 DNS 夹具，不发一个真实包）。
 *
 * 每一条都对应 2026-09-06 真实环境验收里撞到的一个事实，或对应一条**不许因为这次放宽而丢掉**的
 * 安全边界。fake-ip 那两条互为阳性/阴性对照——只有阳性一条会绿的实现（无条件放行 198.18/15）
 * 会在阴性那条上翻红。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyOutboundAddresses,
  coarseAddressLabel,
  isBenchmarkingAddress,
  readOutboundEnvironment,
  setSyntheticResolverProbeForTests,
  type OutboundEnvironment,
} from "./networkOutboundPolicy";
import { isPrivateHost } from "./networkHostPolicy";

const FAKE_IP: OutboundEnvironment = { syntheticResolver: true, syntheticSample: "198.18.0.7" };
const NO_PROXY: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };

afterEach(() => {
  setSyntheticResolverProbeForTests(null);
  delete process.env.LAB_ALLOW_LOCALHOST;
});

describe("fake-ip 代理下的取片放行（含阴性对照）", () => {
  it("检测到合成解析器时，公网域名解析进 198.18/15 放行 —— 这正是 APIMart 取片被拦的那一格", () => {
    expect(
      classifyOutboundAddresses({
        hostname: "api.apimart.ai",
        addresses: [{ address: "198.18.0.140", family: 4 }],
        environment: FAKE_IP,
      }),
    ).toEqual({ allowed: true });
  });

  it("【阴性对照】没有合成解析器证据时，同一个域名、同一个地址仍然拒绝", () => {
    // 这一条是整个放宽的安全前提：无条件放行 198.18/15 的实现会在这里翻红。
    expect(
      classifyOutboundAddresses({
        hostname: "api.apimart.ai",
        addresses: [{ address: "198.18.0.140", family: 4 }],
        environment: NO_PROXY,
      }),
    ).toEqual({ allowed: false, reason: "private-address", observedAddress: "198.18.0.140" });
  });

  it("IP 字面量拿不到豁免：用户直接写 198.18.0.5 时没有域名可供代理解析", () => {
    expect(
      classifyOutboundAddresses({
        hostname: "198.18.0.5",
        addresses: [{ address: "198.18.0.5", family: 4 }],
        environment: FAKE_IP,
      }),
    ).toMatchObject({ allowed: false, reason: "private-address" });
  });

  it("`.local` / `localhost` 也拿不到豁免：它们本来就不是代理会去解析的名字", () => {
    for (const hostname of ["nas.local", "localhost", "printer.localhost"]) {
      expect(
        classifyOutboundAddresses({
          hostname,
          addresses: [{ address: "198.18.0.9", family: 4 }],
          environment: FAKE_IP,
        }),
      ).toMatchObject({ allowed: false, reason: "private-address" });
    }
  });
});

describe("放宽的边界：真正能打到内网的地址一条都没放", () => {
  it.each([
    ["回环", "127.0.0.1"],
    ["RFC 1918 A", "10.1.2.3"],
    ["RFC 1918 B", "172.16.5.5"],
    ["RFC 1918 C", "192.168.1.1"],
    ["云元数据", "169.254.169.254"],
    ["CGNAT", "100.64.0.1"],
  ])("即便在 fake-ip 模式下也拒绝：%s", (_label, address) => {
    expect(
      classifyOutboundAddresses({
        hostname: "attacker-controlled.example",
        addresses: [{ address, family: 4 }],
        environment: FAKE_IP,
      }),
    ).toMatchObject({ allowed: false, reason: "private-address", observedAddress: address });
  });

  it("多解析结果里只要有一个是私网就整体拒绝（不许挑一个能过的用）", () => {
    expect(
      classifyOutboundAddresses({
        hostname: "mixed.example",
        addresses: [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        environment: FAKE_IP,
      }),
    ).toMatchObject({ allowed: false, observedAddress: "127.0.0.1" });
  });

  it("解析不出地址是终态拒绝，不是「放行看看」", () => {
    expect(
      classifyOutboundAddresses({ hostname: "gone.example", addresses: [], environment: FAKE_IP }),
    ).toEqual({ allowed: false, reason: "unresolvable", observedAddress: "" });
  });

  it("公网地址照常放行", () => {
    expect(
      classifyOutboundAddresses({
        hostname: "api.apimart.ai",
        addresses: [{ address: "93.184.216.34", family: 4 }],
        environment: NO_PROXY,
      }),
    ).toEqual({ allowed: true });
  });
});

describe("合成解析器探测（阳性对照法）", () => {
  it("随机不存在的域名被答成 198.18/15 = 本机在跑 fake-ip", async () => {
    const probed: string[] = [];
    setSyntheticResolverProbeForTests(async (hostname) => {
      probed.push(hostname);
      return [{ address: "198.18.0.7", family: 4 }];
    });
    await expect(readOutboundEnvironment()).resolves.toEqual({
      syntheticResolver: true,
      syntheticSample: "198.18.0.7",
    });
    expect(probed[0]).toMatch(/^nomi-fakeip-probe-[a-z0-9]+\./);
  });

  it("探针只用真实 TLD —— .invalid/.test/.example 会被系统本地答成 NXDOMAIN，根本到不了代理", async () => {
    // 这条守的是 2026-09-07 真机实测：用 `.invalid` 探测时，在一台确实开着 fake-ip 的机器上
    // （api.apimart.ai → 198.18.0.140）探针恒 ENOTFOUND，整个放行会静默失效。
    // RFC 6761 要求解析器就地回答这些保留 TLD，规范到根本不出门，所以它们当不了探针。
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

  it("第一个 TLD 解析失败时继续问下一个，不因单个 TLD 异常就判定没有代理", async () => {
    let call = 0;
    setSyntheticResolverProbeForTests(async () => {
      call += 1;
      if (call === 1) throw Object.assign(new Error("EAI_AGAIN"), { code: "EAI_AGAIN" });
      return [{ address: "198.18.9.9", family: 4 }];
    });
    await expect(readOutboundEnvironment()).resolves.toEqual({
      syntheticResolver: true,
      syntheticSample: "198.18.9.9",
    });
  });

  it("正常解析器（NXDOMAIN）→ 判定为没有本地代理，维持拦截（fail-closed）", async () => {
    setSyntheticResolverProbeForTests(async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    await expect(readOutboundEnvironment()).resolves.toEqual({ syntheticResolver: false, syntheticSample: "" });
  });

  it("答得出但不是 198.18/15（如 NXDOMAIN 劫持到落地页）→ 不算 fake-ip", async () => {
    setSyntheticResolverProbeForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(readOutboundEnvironment()).resolves.toEqual({ syntheticResolver: false, syntheticSample: "" });
  });

  it("进程内只探一次：提交那一刻与取回那一刻读到的必须是同一份判定", async () => {
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

describe("私网分类器没有逃生口", () => {
  it("LAB_ALLOW_LOCALHOST=1 不再让 127.0.0.1 变成公网", () => {
    process.env.LAB_ALLOW_LOCALHOST = "1";
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("localhost")).toBe(true);
  });
});

describe("辅助判据", () => {
  it("isBenchmarkingAddress 只认 198.18/15", () => {
    expect(isBenchmarkingAddress("198.18.0.0")).toBe(true);
    expect(isBenchmarkingAddress("198.19.255.255")).toBe(true);
    expect(isBenchmarkingAddress("198.20.0.1")).toBe(false);
    expect(isBenchmarkingAddress("198.17.255.255")).toBe(false);
  });

  it("错误文案里的地址只到 /16 粒度，不泄露完整内网地址", () => {
    expect(coarseAddressLabel("198.18.0.140")).toBe("198.18.x.x");
    expect(coarseAddressLabel("192.168.31.42")).toBe("192.168.x.x");
  });
});
