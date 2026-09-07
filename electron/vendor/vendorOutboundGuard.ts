/**
 * 提交侧的出站授权（付费那一步）。
 *
 * ── 病根（P2 类根因，见 docs/plan/2026-09-07-model-generation-core-path.md）──────────────
 * 上一轮把「目的地该不该出站」收进了 `networkOutboundPolicy`，但只有**取回侧**去问它；提交/轮询
 * 仍然对目的地零策略。于是「我们愿意为之付钱的目的地，可能是我们拒绝读取的目的地」这个不对称，
 * 换个方向仍然成立。本模块是提交侧的那半边——同一个 `authorizeOutboundDestination`、同一份
 * `readOutboundEnvironment` 缓存事实，不是第二个分类器（`check:outbound-policy` 盯着这一点）。
 *
 * ── 为什么私网的 vendor 地址仍然能用 ─────────────────────────────────────────────────
 * 本地 ComfyUI（`http://127.0.0.1:8188`）、局域网里的 LM Studio、自建中转，都是**用户显式填进
 * 模型设置**的接入地址，是配置不是链接。所以它们走「声明式精确 origin 例外」——判据照跑，只是
 * 这个 origin 有用户配置作为证据。这与「提交侧不判」的区别是：后者对任何目的地都放行，包括
 * 任务响应里冒出来的、用户从没见过的地址。
 *
 * 链路本地/元数据段（169.254.x）**不在例外里**，哪怕用户把它填进了 baseUrl：那一段没有供应商，
 * 它唯一的用途是读云主机凭证，而提交请求恰好带着用户的 API Key（判据住在 policy 的 isLinkLocalHost）。
 *
 * ── 为什么提交侧只判、不 pin ────────────────────────────────────────────────────────
 * 取回侧把解析结果 pin 进 dispatcher，是为了堵「先解析成公网、真连接时重绑到内网」的 DNS 重绑。
 * 提交侧的目的地不是任务响应里冒出来的链接，而是用户自己填的接入地址；而且它已经有一条自己的
 * 传输链（vendorBaseFallback 的官方备用域 + 单供应商代理 dispatcher），在这里再插一个 pin 住的
 * dispatcher 会把那条链整个接管掉——那是另一个并行版（P1）。所以这里只回答「能不能出去」，
 * 不接管「怎么出去」。这条取舍连同残余风险登记在 root-cause 合同的 residual_risks。
 */
import { URL } from "node:url";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  authorizeOutboundDestination,
  readOutboundEnvironment,
  type OutboundEnvironment,
  type OutboundRouteKind,
} from "../networkOutboundPolicy";
import { describeOutboundRefusal } from "../networkOutboundMessage";
import { isApplicationProxyActive } from "../systemProxy";
import type { Vendor } from "../catalog/types";

/** 用户显式配置的接入 origin。拿不到（没配 / 填了非法值）就是空——空 = 没有例外，不是放行。 */
export function declaredVendorOrigins(vendor: Pick<Vendor, "baseUrlHint">): string[] {
  const raw = String(vendor.baseUrlHint || "").trim();
  if (!raw) return [];
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? [url.origin] : [];
  } catch {
    return [];
  }
}

/**
 * 注入面（测试用 + 唯一的真实实现）。
 *
 * **任何会走到 `requestVendor` 的单测都必须先 seed 这三样**，绝不许碰真 DNS：夹具 vendor 常常
 * 指着真实域名（`api.kie.ai`），开着 fake-ip 的开发机把它解析成 198.18.x.x 走「被拦」分支，
 * CI 上同一个名字解析得出公网地址走「放行」分支——同一份断言两台机器两条路，正是「本地红、
 * 线上绿」那一族（2026-09-07 实红过 8 条）。抄 `vendorHttp.test.ts` 的 `beforeEach` 那一格：
 * 公网地址 + 无合成解析器 + 无应用代理，让被测文件只测它该测的东西。
 */
export type SubmitOutboundDeps = {
  resolve: (hostname: string) => Promise<readonly { address: string; family: 4 | 6 }[]>;
  readEnvironment: () => Promise<OutboundEnvironment>;
  isApplicationProxyActive: () => boolean;
};

const productionDeps: SubmitOutboundDeps = {
  resolve: async (hostname) => {
    const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
    return resolved.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
  },
  readEnvironment: readOutboundEnvironment,
  isApplicationProxyActive,
};

let deps: SubmitOutboundDeps = productionDeps;

export function setSubmitOutboundDepsForTests(next: Partial<SubmitOutboundDeps> | null): void {
  deps = next ? { ...productionDeps, ...next } : productionDeps;
}

export type SubmitDestinationInput = {
  vendor: Pick<Vendor, "baseUrlHint">;
  /** 已拼好鉴权 query 的最终 URL（判的就是真正要请求的那一个）。 */
  url: string;
  /** 这次请求是否由单供应商显式代理承载（`vendor.network.proxyUrl`）。 */
  routedThroughProviderProxy: boolean;
};

/**
 * 允许出站 → 返回 `null`；被拦 → 返回**已挂机器码**（`NOMI_ERR::outbound-blocked-submit::`）的人话。
 * 调用方据此抛 `VendorRequestError`，码穿过 IPC 后由渲染层 `classifyGenerationError` 认出来。
 *
 * URL 解析不出来时返回 `null`（不拦）：那是调用方拼错了地址，交给既有的 fetch 报错路径去说
 * 「Invalid URL」，比在这里假装成一次安全拒绝诚实。
 */
export async function authorizeSubmitDestination(input: SubmitDestinationInput): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return null;
  }
  const route: OutboundRouteKind =
    input.routedThroughProviderProxy || deps.isApplicationProxyActive() ? "proxy" : "direct";
  const authorization = await authorizeOutboundDestination({
    url,
    route,
    readEnvironment: deps.readEnvironment,
    // 解析失败**不当成安全拒绝**：解析不出来 ≠ 目的地不安全。把它说成策略拒绝会盖掉
    // describeNetworkError 那条已经说得很好的「DNS 解析失败：检查 BaseURL 拼写」，还会把一次
    // 偶发（EAI_AGAIN）说成确定性失败。交回给传输层报，它本来就报得比这里准。
    resolve: async (hostname) => {
      try {
        return await deps.resolve(hostname);
      } catch {
        return [];
      }
    },
    declaredOrigins: declaredVendorOrigins(input.vendor),
  });
  if (authorization.allowed || authorization.reason === "unresolvable") return null;
  return describeOutboundRefusal({
    reason: authorization.reason,
    hostname: authorization.hostname,
    observedAddress: authorization.observedAddress,
    syntheticResolver: authorization.syntheticResolver,
    stage: "submit",
  });
}

