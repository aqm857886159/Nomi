// 提交侧（**花钱那一步**）的出站授权。这份夹具零额度：DNS、环境探针、代理判定全部注入，
// 一次真请求都不发——所以它能常驻 gates，而不是像 `tests/ux/outbound-policy-paid-retrieval.e2e.mjs`
// 那样只在有人愿意付钱时手工跑一次。
//
// 它守的不是「函数返回了什么」，而是**钱**：
//   · 拦下来的那一刻请求还没离开本机 → 用户读到的必须是「没扣费」，而不是取回侧那句「钱已经付过」；
//   · 用户自己配的本地后端（ComfyUI）不能被这条判据误伤，否则等于把私有部署整类用户挡在门外；
//   · 169.254 元数据段哪怕被写进 baseUrl 也不许放行——提交请求带着用户的 API Key。
//
// 每条都配阳性对照：没有对照的绿灯说不清是「判对了」还是「什么都放行 / 什么都拦」。
import { beforeEach, describe, expect, it } from "vitest";
import {
  authorizeSubmitDestination,
  declaredVendorOrigins,
  setSubmitOutboundDepsForTests,
} from "./vendorOutboundGuard";
import { matchNomiErrorCode, stripNomiErrorCode } from "../shared/nomiErrorCodes";
import type { OutboundEnvironment } from "../networkOutboundPolicy";

const NO_LOCAL_PROXY: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };
const FAKE_IP_PROXY: OutboundEnvironment = { syntheticResolver: true, syntheticSample: "198.18.0.7" };

/** 注入整套环境事实。**绝不碰真 DNS**：这台开发机开着 fake-ip，CI 上同一个名字压根解析不出来。 */
function seed(options: {
  address?: string;
  environment?: OutboundEnvironment;
  applicationProxy?: boolean;
  resolveThrows?: boolean;
}): void {
  setSubmitOutboundDepsForTests({
    resolve: async () => {
      if (options.resolveThrows) throw new Error("EAI_AGAIN");
      return options.address ? [{ address: options.address, family: 4 as const }] : [];
    },
    readEnvironment: async () => options.environment ?? NO_LOCAL_PROXY,
    isApplicationProxyActive: () => options.applicationProxy ?? false,
  });
}

const apimart = { baseUrlHint: "https://api.apimart.ai" };

describe("提交侧出站授权：被拦 = 没扣费", () => {
  beforeEach(() => setSubmitOutboundDepsForTests(null));

  it("fake-ip 合成地址 + 没有代理证据 → 拦下，且挂的是**提交侧**的码", async () => {
    seed({ address: "198.18.0.140", environment: NO_LOCAL_PROXY });
    const refusal = await authorizeSubmitDestination({
      vendor: apimart,
      url: "https://api.apimart.ai/v1/tasks",
      routedThroughProviderProxy: false,
    });
    expect(refusal).toBeTruthy();
    // 码认对了才算数：取回侧的 `outbound-blocked` 会让渲染层说「钱已经付过、免费重取」——
    // 在提交侧那是一句方向完全相反的假话，还会指向一颗根本不存在的按钮。
    expect(matchNomiErrorCode(refusal as string)).toBe("outbound-blocked-submit");
    // 人话里必须真的写着「没有扣费」。这一条看似在测文案，实际测的是两套词表没有被接错线。
    expect(stripNomiErrorCode(refusal as string)).toMatch(/没有扣费|nothing was charged/i);
  });

  it("【阳性对照】同一个地址 + 探到了 fake-ip 代理 → 放行（否则这条判据只是「一律拦」）", async () => {
    seed({ address: "198.18.0.140", environment: FAKE_IP_PROXY });
    await expect(
      authorizeSubmitDestination({ vendor: apimart, url: "https://api.apimart.ai/v1/tasks", routedThroughProviderProxy: false }),
    ).resolves.toBeNull();
  });

  it("【阳性对照】公网地址一律放行——判据不能把正常出站也拦了", async () => {
    seed({ address: "104.18.32.7", environment: NO_LOCAL_PROXY });
    await expect(
      authorizeSubmitDestination({ vendor: apimart, url: "https://api.apimart.ai/v1/tasks", routedThroughProviderProxy: false }),
    ).resolves.toBeNull();
  });

  it("用户自己配的本地 ComfyUI 走声明式例外，照常提交", async () => {
    seed({ environment: NO_LOCAL_PROXY });
    await expect(
      authorizeSubmitDestination({
        vendor: { baseUrlHint: "http://127.0.0.1:8188" },
        url: "http://127.0.0.1:8188/prompt",
        routedThroughProviderProxy: false,
      }),
    ).resolves.toBeNull();
  });

  it("【阴性对照】同一个回环地址、换个端口就不是那个声明 → 拦（例外只认完全同源）", async () => {
    seed({ environment: NO_LOCAL_PROXY });
    const refusal = await authorizeSubmitDestination({
      vendor: { baseUrlHint: "http://127.0.0.1:8188" },
      url: "http://127.0.0.1:9999/prompt",
      routedThroughProviderProxy: false,
    });
    expect(matchNomiErrorCode(refusal as string)).toBe("outbound-blocked-submit");
  });

  it("169.254 元数据段：写进 baseUrl 也买不通——提交请求带着 API Key", async () => {
    seed({ environment: NO_LOCAL_PROXY });
    const refusal = await authorizeSubmitDestination({
      vendor: { baseUrlHint: "http://169.254.169.254" },
      url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      routedThroughProviderProxy: false,
    });
    expect(matchNomiErrorCode(refusal as string)).toBe("outbound-blocked-submit");
  });

  it("代理承载这次请求时**仍然判**，只是判名字：私网字面量照拦（这才不是逃生口）", async () => {
    // 地址层给一个公网答案，证明拦下来的判据来自名字而不是解析结果。
    seed({ address: "104.18.32.7", environment: NO_LOCAL_PROXY });
    const refusal = await authorizeSubmitDestination({
      vendor: { baseUrlHint: "https://relay.example.com" },
      url: "http://10.0.0.5/v1/tasks",
      routedThroughProviderProxy: true,
    });
    expect(matchNomiErrorCode(refusal as string)).toBe("outbound-blocked-submit");
  });

  it("【阳性对照】代理承载 + 公网名字 → 放行，且不拿本机解析结果当判据", async () => {
    // 本机把它解析成 fake-ip 合成地址且没有代理证据：直连路由下这会被拦，代理路由下不该被拦，
    // 因为代理在它那侧自己解析——本机这份答案根本不是这次连接会用的那一份。
    seed({ address: "198.18.0.140", environment: NO_LOCAL_PROXY });
    await expect(
      authorizeSubmitDestination({
        vendor: apimart,
        url: "https://api.apimart.ai/v1/tasks",
        routedThroughProviderProxy: true,
      }),
    ).resolves.toBeNull();
  });

  it("解析不出来不算安全拒绝——交回传输层去报「DNS 解析失败」，别栽赃成策略拦截", async () => {
    seed({ resolveThrows: true, environment: NO_LOCAL_PROXY });
    await expect(
      authorizeSubmitDestination({ vendor: apimart, url: "https://api.apimart.ai/v1/tasks", routedThroughProviderProxy: false }),
    ).resolves.toBeNull();
  });

  it("declaredVendorOrigins 只认合法 http(s) 的 origin，拿不到就是空（空 = 没有例外，不是放行）", () => {
    expect(declaredVendorOrigins({ baseUrlHint: "https://api.apimart.ai/v1/" })).toEqual(["https://api.apimart.ai"]);
    expect(declaredVendorOrigins({ baseUrlHint: "file:///etc/passwd" })).toEqual([]);
    expect(declaredVendorOrigins({ baseUrlHint: "  " })).toEqual([]);
    expect(declaredVendorOrigins({ baseUrlHint: null })).toEqual([]);
  });
});
