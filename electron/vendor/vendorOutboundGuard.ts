/**
 * 提交侧的出站授权（付费那一步）。
 *
 * ── 两条判据，一个 owner ────────────────────────────────────────────────────────────
 * ① **目的地安不安全**：问的是同一个 `authorizeOutboundDestination`（不是第二个分类器，
 *    `check:outbound-policy` 盯着）。创作者保存的接入地址（`baseUrlHint` 的精确 origin，不分 http / https）
 *    在那里直接放行、**不按解析出的地址判**（2026-11-12 用户拍板，方向复盘
 *    `docs/engineering/direction-checks/2026-11-12-outbound-guard.md`）：https 下证书校验已经挡住
 *    「域名被解析到内网机器」，提交侧又不锁定地址，这条判断换来的只有开着代理的创作者每次都发不出去。
 *    留着的：URL 里直接写内网 IP / localhost 且不等于接入地址 → 拒；链路本地永远拒；供应商响应里带回来的
 *    地址（预签名上传目标等）不是「保存的」，按取回侧同一套判。
 * ② **这把 key 该不该去那儿**：带用户密钥的请求，origin 必须等于贴 key 页上确认并保存的
 *    那一个（`catalog/credentialBinding.ts`）。这一层是两条执行路（mapping 与 customCall 脚本）共用的最早边界。
 *
 * ── 为什么提交侧只判、不 pin ────────────────────────────────────────────────────────
 * 提交侧的目的地是用户自己填的接入地址，它已经有一条自己的传输链（vendorBaseFallback 的官方备用域 +
 * 单供应商代理 dispatcher），在这里再插一个 pin 住的 dispatcher 会把那条链整个接管掉（P1 并行版）。
 * 所以这里只回答「能不能出去」，不接管「怎么出去」。
 */
import { URL } from "node:url";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  authorizeOutboundDestination,
  isLinkLocalHost,
  readOutboundEnvironment,
  type OutboundRouteKind,
  type ReadOutboundEnvironment,
} from "../networkOutboundPolicy";
import { describeOutboundRefusal } from "../networkOutboundMessage";
import { isApplicationProxyActive } from "../systemProxy";
import { judgeCredentialDestination, readCredentialBinding } from "../catalog/credentialBinding";
import { tagNomiError } from "../shared/nomiErrorCodes";
import { codeDeclaredFallbackOrigins } from "./vendorBaseFallback";
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
 * 取回侧的声明式例外：成片恰好就在**这条连接保存的接入地址**的精确 origin 上，就把这个 origin 交给取回
 * （#975 起只给私网字面量；2026-11-12 起同 origin 都给）。
 *
 * 为什么必须和提交侧同一句判据：付费请求和 key 已经按 `declaredVendorOrigins` 发到了这个 origin，提交侧
 * 对它不判地址；取回侧若还按地址判，就是「提交放行、取回拒绝」——扣了钱取不回（2026-09-06）。局域网
 * 主机名接入地址（`http://mypc.lan:8000` 解析到 192.168.x）就是那一格。
 * 为什么只信它：协议 + 主机 + 端口三样完全一致才算；同主机换端口、别的内网地址照旧被出站策略拒。
 * 链路本地（169.254 / fe80）永远不给：策略本身也不让任何声明买通它。
 * 跳转：取回侧只对「私网字面量声明」那一跳关跳转（`hardenedFetch`），公网接入地址照常能跳到 CDN；
 * 跳转后的每一跳不再享受声明例外。
 *
 * 这是**唯一**一处回答「取回某家产物时额外信任哪个 origin」的地方：画布那条（localizeTaskAsset）
 * 与正式生成那条（generationOutputMaterializer）都只问它。
 */
export async function trustedRetrievalOrigin(
  vendor: Pick<Vendor, "baseUrlHint"> | null | undefined,
  resultUrl: string,
): Promise<string | undefined> {
  if (!vendor) return undefined;
  const [origin] = declaredVendorOrigins(vendor);
  if (!origin) return undefined;
  let url: URL;
  try {
    url = new URL(resultUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== origin || isLinkLocalHost(url.hostname)) return undefined;
  return origin;
}

/**
 * 注入面（测试用 + 唯一的真实实现）。
 *
 * **任何会走到 `requestVendor` 的单测都必须先 seed 这三样**，绝不许碰真 DNS：夹具 vendor 常常
 * 指着真实域名（`api.kie.ai`），开着 fake-ip 的开发机与 CI 上同一个名字会走不同分支。
 * `readEnvironment` 的夹具忽略 `{ fresh: true }` 就等于「重探结果不变」。
 */
export type SubmitOutboundDeps = {
  resolve: (hostname: string) => Promise<readonly { address: string; family: 4 | 6 }[]>;
  readEnvironment: ReadOutboundEnvironment;
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
  // `key` 只用来查「代码里写死的官方备用域」；查不到 = 没有例外，不是放行，所以它可选。
  vendor: Pick<Vendor, "baseUrlHint">
    & Partial<Pick<Vendor, "key" | "credentialBinding" | "authType" | "authHeader" | "authQueryParam" | "authScheme">>;
  /** 已拼好鉴权 query 的最终 URL（判的就是真正要请求的那一个）。 */
  url: string;
  /** 这次请求是否由单供应商显式代理承载（`vendor.network.proxyUrl`）。 */
  routedThroughProviderProxy: boolean;
  /**
   * 这次请求**带着用户的密钥**吗（`collectRequestSecretValues` 说了算，不在这里重猜）。
   * 不带 key 的第二步上传（预签名 URL 那类动态目标）照旧只过私网策略。
   */
  carriesCredential?: boolean;
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
  // ── 判据二：带 key 的请求只能去用户亲眼确认过的那个 origin（§6.1，2026-09-18） ──────────
  // 放在私网策略**之前**，因为它比私网更具体：一个公网 origin 完全可能通过私网策略，
  // 却不是用户保存 key 时看见的那一个（Agent 事后改地址、旧数据、手改 catalog 文件、
  // 说明卡里一条绝对 URL）。这不是第二个目的地分类器——它问的是另一个问题
  //（「这把 key 的家在哪」），答案由 catalog 的绑定事务给，不重新判「这个地址安不安全」。
  if (input.carriesCredential) {
    const verdict = judgeCredentialDestination({
      binding: readCredentialBinding(input.vendor),
      url: input.url,
      codeDeclaredOrigins: codeDeclaredFallbackOrigins(String(input.vendor.key || "")),
      placement: input.vendor,
    });
    if (!verdict.allowed) {
      // 码由 `tagNomiError` 挂，不手拼字面量——码表是 `shared/nomiErrorCodes.ts` 唯一 owner。
      // 人话里只放**这次的几个事实**（绑定的是哪个、要去哪个、变的是哪一样）；「怎么办」由渲染层
      // 的词表说，那边才有 i18n（这里写死中文 = 英文用户读到半句中文）。
      return tagNomiError(
        "outbound-blocked-credential-origin",
        `changed=${verdict.changed} bound=${verdict.boundOrigin} attempted=${verdict.attemptedOrigin}`,
      );
    }
  }
  const route: OutboundRouteKind =
    input.routedThroughProviderProxy || deps.isApplicationProxyActive() ? "proxy" : "direct";
  const authorization = await authorizeOutboundDestination({
    url,
    route,
    stage: "submit",
    proxyKind: input.routedThroughProviderProxy ? "provider" : "application",
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

