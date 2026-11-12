/**
 * 出站目的地策略的**唯一 owner**（P2 类根因修复，见 docs/fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json，
 * 以及 2026-11-12 的方向复盘 docs/engineering/direction-checks/2026-11-12-outbound-guard.md）。
 *
 * 提交侧（`vendorOutboundGuard.authorizeSubmitDestination`）与取回侧（`hardenedFetch`）问的是**同一个**
 * `authorizeOutboundDestination`、读同一份 `readOutboundEnvironment`；`check:outbound-policy` 棘轮盯着所有
 * `appFetch` / `isPrivateHost` 的引用点，谁再长出第二个分类器都会报红。
 *
 * ── 判据按层，依次问 ─────────────────────────────────────────────────────────────────
 *  1. 链路本地（169.254 / fe80）：**永远拒**，任何声明都买不通（云主机元数据通道，见 isLinkLocalHost）。
 *  2. 创作者保存的接入地址（`declaredOrigins`，精确 origin）：放行，**不解析、不判地址**。
 *     2026-11-12 起（用户拍板）提交侧不再按解析出的地址拦它：https 下证书校验已经挡住「域名被解析到内网
 *     机器」那件事，而提交侧判完并不锁定地址，挡不住中途换解析；这条判断换来的只有「开着代理的创作者每次
 *     都发不出去」。OWASP SSRF 速查表把「只连已知可信目标」与「连任意外来链接」分开，前者不建议用 DNS 解析
 *     做校验；Cherry Studio 对用户配的供应商地址也只做字面量检查。取回侧对「成片就在这家接入地址上」用同一句
 *     判据——提交放行的地方，取回必须也能过（否则就是 2026-09-06 的「扣了钱取不回」）。
 *  3. 名字层：URL 里直接写的私网 / 回环 IP、localhost、.local → 拒（声明过的精确 origin 已在第 2 层放行）。
 *  4. 走代理的连接（应用代理 / 单供应商代理）：代理在它那侧解析，本机答案不是这次连接会用的那份 → 只判名字。
 *  5. 本机解析器在合成答案（TUN / fake-ip 代理）且目标是可被代理解析的域名 → 同第 4 层，只判名字，不解析、不 pin。
 *     这和 Chromium 本地网络访问对代理连接的处理一致：本机那份地址不是真目的地，拿它判等于判一个不存在的东西。
 *  6. 其余直连：解析全部地址，任何一个落在保留段 → 拒；**拒之前当场重探一次**合成解析器（先开 Nomi 后开代理、
 *     冷启动 DNS 慢，进程里缓存的那次探测会一直判成「没代理」），重探确认了就按第 5 层放行，结果写回缓存。
 *     放行时把地址交回去 pin 住（防解析后重绑）——这一层守的是供应商响应里冒出来的陌生链接。
 *
 * ── 合成解析器怎么认（阳性证据，不枚举代理软件的地址段）─────────────────────────────
 * 向一个**随机的、不可能存在的域名**发一次 DNS 查询。正常解析器必答 NXDOMAIN；答得出、且答案落在任何
 * 保留段（`isPrivateHost` 那张表：v4 198.18/15、v6 2001:2::/48、fc00::/7 ……）= 本机解析器在合成答案。
 * 不认某一家的默认段：Clash Verge Rev 开 IPv6 时给 2001:2::/64、mihomo 的 TUN 是 fdfe:dcba:9876::/126、
 * v2rayN 有 fc00::/18——上一版只认 IPv4 198.18/15，下一个默认值一来就再坏一次（2026-11 就是这么坏的）。
 * 答成公网地址（运营商 NXDOMAIN 劫持到落地页）不算证据。探测失败 / 超时 / 答不出 → 按没有处理。
 *
 * **探测名必须用真实 TLD（.com/.net），不能用 `.invalid`/`.test`/`.example`。** 2026-09-07 真机实测：
 * RFC 6761 要求解析器**在本地**就把这些保留 TLD 答成 NXDOMAIN，查询根本到不了代理：
 *
 *     nomi-fakeip-probe-74rf3q9vwd.com     -> 198.18.2.228   （代理答的，✅ 证据成立）
 *     nomi-fakeip-probe-gqortvorri.invalid -> ENOTFOUND      （❌ 系统本地答的，探不到代理）
 *
 * 残余风险（登记在方向复盘）：确认合成解析期间，取回侧对公网名失去「解析到内网」的拦截；把不存在的名字
 * 劫持到私网地址的路由器也会被认成「在用代理」。
 *
 * 逃生口：本模块**没有** env 开关。实验室要的 loopback 由 `main.ts` 在 `!app.isPackaged` 时
 * 显式注入精确 origin（`setLabTrustedPrivateOrigins`），打包版本连读都不读。
 */
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { isPrivateHost } from "./networkHostPolicy";
import type { OutboundAddressClass, OutboundProbeOutcome, OutboundRefusalTelemetryProps } from "./shared/contracts/telemetry";

export type ResolvedHostAddress = { address: string; family: 4 | 6 };

/** 合成解析器探测的超时：DNS 是启动路径上的同步依赖，绝不允许它拖住第一次生成。 */
const SYNTHETIC_PROBE_TIMEOUT_MS = 1_500;

export type OutboundRefusalReason =
  /** URL 里直接写了私网/回环/链路本地主机名或 IP 字面量。 */
  | "private-host"
  /** 主机名本身公网，但解析结果落在保留段（且重探后仍没确认本机在用代理）。 */
  | "private-address"
  /** 解析不出任何地址。 */
  | "unresolvable";

/**
 * 出站被策略拒绝时的**结构化**错误（不是裸 `new Error(字符串)`）。
 * 下游要能区分「我们自己的策略拦的」与「上游挂了」，并据此给出不同的下一步。
 */
export class OutboundDestinationRefusedError extends Error {
  readonly reason: OutboundRefusalReason;
  readonly hostname: string;
  /** 触发拒绝的那个地址（`private-host`/`unresolvable` 时为空串）。 */
  readonly observedAddress: string;
  /** 拒绝发生时本机是否被判定为合成解析器（写进错误，便于事后对账）。 */
  readonly syntheticResolver: boolean;

  constructor(input: {
    reason: OutboundRefusalReason;
    hostname: string;
    observedAddress?: string;
    syntheticResolver: boolean;
    message: string;
  }) {
    super(input.message);
    this.name = "OutboundDestinationRefusedError";
    this.reason = input.reason;
    this.hostname = input.hostname;
    this.observedAddress = input.observedAddress || "";
    this.syntheticResolver = input.syntheticResolver;
  }
}

export function isOutboundDestinationRefusedError(error: unknown): error is OutboundDestinationRefusedError {
  return error instanceof OutboundDestinationRefusedError;
}

// ── 环境事实：进程内缓存一份，提交与取回读同一份；要拒之前可当场重探并写回 ─────────────

export type OutboundEnvironment = {
  /** 本机解析器在合成答案（fake-ip 代理，含 TUN 透明模式——那种模式下 app 看不到任何代理设置）。 */
  syntheticResolver: boolean;
  /** 探测时观察到的合成地址样本，供设置页状态行引用。 */
  syntheticSample: string;
};

/**
 * 读环境事实。`fresh: true` = 不用缓存、当场重探一次，结果写回缓存（之后所有读者读到的都是新值）。
 * 注入点（测试）只要实现这一个签名：忽略 `fresh` 的夹具就是「环境不变」。
 */
export type ReadOutboundEnvironment = (options?: { fresh?: boolean }) => Promise<OutboundEnvironment>;

const NO_SYNTHETIC_RESOLVER: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };

let environmentProbe: Promise<OutboundEnvironment> | null = null;
let freshProbe: Promise<OutboundEnvironment> | null = null;
let lastKnownEnvironment: OutboundEnvironment = NO_SYNTHETIC_RESOLVER;

/** 注入点（测试用）：默认走真实 DNS。 */
export type SyntheticResolverProbe = (hostname: string) => Promise<readonly ResolvedHostAddress[]>;

let probeImpl: SyntheticResolverProbe = async (hostname) => {
  const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
  return resolved.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
};

/** 探针 TLD：必须是**真实可路由**的 TLD，理由见文件头。两个是为了容忍单个 TLD 的解析异常。 */
const PROBE_TLDS = ["com", "net"] as const;

/** 随机标签：避免任何一层（系统 / 路由器 / 代理）把上一次的答案缓存成永久事实。 */
function probeHostname(tld: string): string {
  return `nomi-fakeip-probe-${Math.random().toString(36).slice(2, 12)}.${tld}`;
}

async function lookupWithTimeout(hostname: string): Promise<readonly ResolvedHostAddress[]> {
  return Promise.race([
    probeImpl(hostname),
    new Promise<readonly ResolvedHostAddress[]>((_, reject) =>
      setTimeout(() => reject(new Error("synthetic resolver probe timed out")), SYNTHETIC_PROBE_TIMEOUT_MS).unref?.(),
    ),
  ]);
}

/**
 * 阳性对照式探测：查一个随机的不可能存在的域名。
 * 答得出地址、且任何一个落在保留段 = 本机解析器在合成。不枚举代理软件的段，v4 / v6 一视同仁。
 * 任何异常（NXDOMAIN / 超时 / 无网络）都按「没有合成解析器」返回。
 */
async function probeSyntheticResolver(): Promise<OutboundEnvironment> {
  for (const tld of PROBE_TLDS) {
    try {
      const addresses = await lookupWithTimeout(probeHostname(tld));
      const synthetic = addresses.find((entry) => isPrivateHost(entry.address));
      if (synthetic) return { syntheticResolver: true, syntheticSample: synthetic.address };
    } catch {
      // NXDOMAIN 是**正常解析器**的正确答案，继续问下一个 TLD；两个都没给出合成地址才收工。
    }
  }
  return NO_SYNTHETIC_RESOLVER;
}

/**
 * 读环境事实。默认读进程内缓存（第一次才探）；`fresh: true` 当场重探，并发的重探共用同一次，
 * 结果写回缓存——设置页那一行与之后的每一次判定读到的都是这次的新结论。
 */
export async function readOutboundEnvironment(options: { fresh?: boolean } = {}): Promise<OutboundEnvironment> {
  if (options.fresh) {
    if (!freshProbe) {
      const probe = probeSyntheticResolver().then((environment) => {
        lastKnownEnvironment = environment;
        environmentProbe = probe;
        return environment;
      });
      freshProbe = probe;
      void probe.finally(() => {
        if (freshProbe === probe) freshProbe = null;
      });
    }
    return freshProbe;
  }
  if (!environmentProbe) {
    environmentProbe = probeSyntheticResolver().then((environment) => {
      lastKnownEnvironment = environment;
      return environment;
    });
  }
  return environmentProbe;
}

/** 同步快照（设置页状态行用）；尚未探过时如实返回「未检测到」。 */
export function lastOutboundEnvironment(): OutboundEnvironment {
  return lastKnownEnvironment;
}

/** 代理偏好变更后重新探测（线路换了，合成解析器可能跟着换）。 */
export function invalidateOutboundEnvironment(): void {
  environmentProbe = null;
}

export function setSyntheticResolverProbeForTests(probe: SyntheticResolverProbe | null): void {
  probeImpl = probe ?? (async (hostname) => {
    const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
    return resolved.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
  });
  environmentProbe = null;
  freshProbe = null;
  lastKnownEnvironment = NO_SYNTHETIC_RESOLVER;
}

// ── 实验室 loopback：显式精确 origin，由 main.ts 在非打包构建里注入 ──────────────────

let labTrustedPrivateOrigins: readonly string[] = [];

/**
 * 只接受**精确 origin**（`http://127.0.0.1:5199` 这种），永远不放宽分类器本身。
 * 由 `main.ts` 在 `!app.isPackaged` 时调用；打包版本一次都不调，逃生口在生产路径上不存在。
 */
export function setLabTrustedPrivateOrigins(origins: readonly string[]): void {
  labTrustedPrivateOrigins = origins
    .map((raw) => {
      try {
        const url = new URL(raw.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function getLabTrustedPrivateOrigins(): readonly string[] {
  return labTrustedPrivateOrigins;
}

/**
 * 未打包构建的唯一读取点：把 `NOMI_LAB_TRUSTED_PRIVATE_ORIGINS`（逗号分隔的精确 origin）
 * 交给上面的白名单。**打包版本传 isPackaged=true 即整体空操作**——逃生口在生产路径上不存在，
 * 这正是它与旧 `LAB_ALLOW_LOCALHOST=1` 的区别：那个开关随包发布，且关掉的是整个分类器。
 */
export function seedLabTrustedPrivateOrigins(isPackaged: boolean): void {
  if (isPackaged) return;
  const origins = String(process.env.NOMI_LAB_TRUSTED_PRIVATE_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (origins.length) setLabTrustedPrivateOrigins(origins);
}

// ── 判据（纯函数，直测）────────────────────────────────────────────────────────────

export type OutboundVerdict =
  | { allowed: true }
  | { allowed: false; reason: OutboundRefusalReason; observedAddress: string };

/**
 * 主机名是否是「可能被代理接管的公网名字」。
 * IP 字面量没有域名可供代理解析，那就是在指一个具体地址；localhost / .local / 单标签名不出本机或局域网。
 */
function isProxyResolvableName(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host || net.isIP(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  return host.includes(".");
}

/** 共用判据：一组已解析地址能不能直连。任何一个落在保留段即整体拒绝（不许挑一个能过的用）。 */
export function classifyOutboundAddresses(input: { addresses: readonly ResolvedHostAddress[] }): OutboundVerdict {
  const { addresses } = input;
  if (!addresses.length) return { allowed: false, reason: "unresolvable", observedAddress: "" };
  const reserved = addresses.find((entry) => isPrivateHost(entry.address));
  return reserved ? { allowed: false, reason: "private-address", observedAddress: reserved.address } : { allowed: true };
}

/** 把一个地址折成可安全展示的粗粒度前缀（错误文案/日志用，不泄露完整内网地址）。 */
export function coarseAddressLabel(address: string): string {
  if (!net.isIPv4(address)) return address;
  const octets = address.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.x.x` : address;
}

// ── 拒绝的子码（遥测用：只有枚举，没有地址、域名或任何用户内容）──────────────────────

/** 这次出站的 TCP 连接由谁去开：`direct` = Nomi 自己开；`proxy` = 应用级或单供应商代理替我们开（DNS 在代理那侧）。 */
export type OutboundRouteKind = "direct" | "proxy";

/** 这次出站是「花钱那一步」还是「拿东西那一步」——两者被拦时用户该做的事完全不同。 */
export type OutboundStage = "submit" | "retrieval";

/** 代理路由的细分（遥测子码用）：应用级代理 / 这家供应商单配的代理。 */
export type OutboundProxyKind = "application" | "provider";

/** 子码词表在共享遥测契约里（主进程门口按同一张表校验）；这里只负责把一次拒绝归到表里的哪一格。 */
export type OutboundRefusalFacts = OutboundRefusalTelemetryProps & { reason: OutboundRefusalReason; stage: OutboundStage };

function inRanges(address: string, type: "ipv4" | "ipv6", ranges: readonly (readonly [string, number])[]): boolean {
  const list = new net.BlockList();
  for (const [base, prefix] of ranges) list.addSubnet(base, prefix, type);
  return list.check(address, type);
}

function addressClassOf(address: string): OutboundAddressClass {
  const family = net.isIP(address);
  if (!family) return address ? "name" : "none";
  if (!isPrivateHost(address)) return "public";
  if (family === 4) {
    if (inRanges(address, "ipv4", [["127.0.0.0", 8]])) return "loopback";
    if (inRanges(address, "ipv4", [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]])) return "rfc1918";
    if (inRanges(address, "ipv4", [["100.64.0.0", 10]])) return "cgnat";
    if (inRanges(address, "ipv4", [["169.254.0.0", 16]])) return "link-local";
    if (inRanges(address, "ipv4", [["198.18.0.0", 15]])) return "benchmarking-v4";
    return "other-reserved";
  }
  if (inRanges(address, "ipv6", [["::1", 128]])) return "loopback";
  if (inRanges(address, "ipv6", [["fe80::", 10]])) return "link-local";
  if (inRanges(address, "ipv6", [["fc00::", 7]])) return "unique-local-v6";
  if (inRanges(address, "ipv6", [["2001::", 23]])) return "ietf-protocol-v6";
  return "other-reserved";
}

type OutboundRefusalReporter = (facts: OutboundRefusalFacts) => void;
let refusalReporter: OutboundRefusalReporter | null = null;

/** 主进程启动时接上匿名遥测（`telemetry/telemetryLifecycle.ts`）；测试可注入。报告器抛错不影响判定。 */
export function setOutboundRefusalReporter(reporter: OutboundRefusalReporter | null): void {
  refusalReporter = reporter;
}

// ── 单一入口：任何出站在**发出之前**都问这一次 ──────────────────────────────────────

/** 放行的依据（取回侧据此决定这一跳之后能不能跟跳转；测试据此对账）。 */
export type OutboundAllowedBasis =
  /** 名字本身是私网 / 回环字面量，但它就是声明过的那个精确 origin（本地 ComfyUI、局域网 IP 接入地址）。 */
  | "declared-private-origin"
  /** 创作者保存的接入地址（名字不是私网字面量）：不解析、不判地址。 */
  | "declared-origin"
  | "proxy-route"
  | "synthetic-resolver"
  | "resolved-public";

export type OutboundAuthorization =
  | { allowed: true; route: OutboundRouteKind; basis: OutboundAllowedBasis; pinnedAddresses: readonly ResolvedHostAddress[] | null }
  | {
      allowed: false;
      reason: OutboundRefusalReason;
      hostname: string;
      observedAddress: string;
      syntheticResolver: boolean;
    };

/**
 * 链路本地段（IPv4 169.254/16、IPv6 fe80::/10）。**任何显式声明的 origin 都买不通它。**
 * 169.254.169.254 是云主机的元数据通道，没有任何供应商住在那儿，它唯一的用途是把凭证读出来。
 */
export function isLinkLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (net.isIPv4(bare)) return bare.startsWith("169.254.");
  if (net.isIPv6(bare)) return /^fe[89ab][0-9a-f]:/.test(bare);
  return false;
}

/** 声明式例外只认**完全同源**（`http://127.0.0.1:8188` 这种），不认前缀、不认子域。 */
export function matchesDeclaredOrigin(url: URL, declaredOrigins: readonly string[]): boolean {
  return declaredOrigins.some((raw) => {
    try {
      const declared = new URL(String(raw).trim());
      return (declared.protocol === "http:" || declared.protocol === "https:") && declared.origin === url.origin;
    } catch {
      return false;
    }
  });
}

/** URL 里的主机名去掉 IPv6 的方括号，得到可以直接解析/判定的形态。 */
export function connectionHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

/**
 * **出站授权的唯一入口**（提交侧与取回侧都走这一个函数）。判据按层依次问，见文件头。
 *
 * 先查别人：GitLab #378267（<https://gitlab.com/gitlab-org/gitlab/-/work_items/378267>）配了代理就整段关掉
 * DNS 重绑保护；我们不整段关，只在有阳性证据（代理路由 / 确认合成解析器）时把判据从地址换成名字。
 * 「代理路由下该判名字」是 SOCKS5 的既定语义：curl `--socks5-hostname` 交给代理解析
 * （<https://curl.se/docs/manpage.html#--socks5-hostname>），本机那份答案根本不参与连接。
 */
export async function authorizeOutboundDestination(input: {
  url: URL;
  route: OutboundRouteKind;
  /** 哪一步在问（只用于拒绝的遥测子码；判据两步一样）。 */
  stage: OutboundStage;
  /** 代理路由时是哪一种代理（只用于遥测子码）。 */
  proxyKind?: OutboundProxyKind;
  /** 懒读：名字层就能定案时不触发 DNS 探针。`{ fresh: true }` = 拒之前当场重探。 */
  readEnvironment: ReadOutboundEnvironment;
  resolve: (hostname: string) => Promise<readonly ResolvedHostAddress[]>;
  /** 创作者**显式保存**的接入 origin（供应商 baseUrl / 已配置的本地 ComfyUI / 实验室夹具）。 */
  declaredOrigins?: readonly string[];
}): Promise<OutboundAuthorization> {
  const { url, route, readEnvironment, resolve } = input;
  const hostname = connectionHostname(url.hostname);
  const declared = [...(input.declaredOrigins || []), ...labTrustedPrivateOrigins];
  const refuse = (
    reason: OutboundRefusalReason,
    observedAddress: string,
    syntheticResolver: boolean,
    probe: OutboundProbeOutcome,
  ): OutboundAuthorization => {
    const subject = observedAddress || (reason === "unresolvable" ? "" : hostname);
    const family = net.isIP(subject);
    try {
      refusalReporter?.({
        stage: input.stage,
        reason,
        route: route === "direct" ? "direct" : input.proxyKind === "provider" ? "provider-proxy" : "app-proxy",
        addressFamily: family === 4 ? "4" : family === 6 ? "6" : "none",
        addressClass: addressClassOf(subject),
        syntheticResolver,
        probe,
      });
    } catch {
      // 遥测坏了不许改判定。
    }
    return { allowed: false, reason, hostname, observedAddress, syntheticResolver };
  };
  // 1. 链路本地：任何声明都买不通。
  if (isLinkLocalHost(hostname)) return refuse("private-host", "", lastKnownEnvironment.syntheticResolver, "not-probed");
  const namePrivate = isPrivateHost(url.hostname);
  // 2. 创作者保存的接入地址（精确同源）：不解析、不判地址。
  if (matchesDeclaredOrigin(url, declared)) {
    return { allowed: true, route, basis: namePrivate ? "declared-private-origin" : "declared-origin", pinnedAddresses: null };
  }
  // 3. 名字层（两条路由都判）。
  if (namePrivate) return refuse("private-host", "", lastKnownEnvironment.syntheticResolver, "not-probed");
  // 4. 代理路由：地址层的判据在代理那侧，我们手上没有它。
  if (route === "proxy") return { allowed: true, route, basis: "proxy-route", pinnedAddresses: null };
  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    // 公网 IP 字面量（私网字面量已在名字层拒掉）：就是这个地址，pin 住。
    return { allowed: true, route, basis: "resolved-public", pinnedAddresses: [{ address: hostname, family: literalFamily as 4 | 6 }] };
  }
  const proxyResolvable = isProxyResolvableName(hostname);
  // 5. 本机解析器在合成答案：本机这份地址不是真目的地，只判名字。
  let environment = proxyResolvable ? await readEnvironment() : lastKnownEnvironment;
  if (proxyResolvable && environment.syntheticResolver) {
    return { allowed: true, route, basis: "synthetic-resolver", pinnedAddresses: null };
  }
  // 6. 直连地址层。
  const addresses = await resolve(hostname);
  const verdict = classifyOutboundAddresses({ addresses });
  if (verdict.allowed) return { allowed: true, route, basis: "resolved-public", pinnedAddresses: addresses };
  if (verdict.reason === "unresolvable") {
    return refuse("unresolvable", "", environment.syntheticResolver, proxyResolvable ? "unconfirmed" : "not-probed");
  }
  // 要按地址拒了：先当场重探一次（先开应用后开代理、冷启动 DNS 慢，缓存里那次会一直判成「没代理」）。
  if (proxyResolvable) {
    environment = await readEnvironment({ fresh: true });
    if (environment.syntheticResolver) return { allowed: true, route, basis: "synthetic-resolver", pinnedAddresses: null };
  }
  return refuse(
    "private-address",
    verdict.observedAddress,
    environment.syntheticResolver,
    proxyResolvable ? "unconfirmed-after-reprobe" : environment.syntheticResolver ? "confirmed" : "not-probed",
  );
}
