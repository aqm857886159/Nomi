/**
 * 出站目的地策略的**唯一 owner**（P2 类根因修复，见 docs/fixes/2026-09-07-outbound-policy-split-across-submit-and-retrieval.root-cause.json）。
 *
 * 病根不是「黑名单多了一段」，而是**同一次生成的出站决策被判了两次**：
 *   · 提交/轮询走 vendorHttp → appFetch，对目的地**零策略**（信任用户配置的 vendor origin）；
 *   · 取回产物走 hardenedFetch，对目的地做 DNS 解析 + 私网分类，**可以拒绝**。
 * 于是存在一个致命的不对称：**我们愿意为之付钱的目的地，可能是我们拒绝读取的目的地**。
 * 2026-09-06 真实验收就撞上了：Clash/Surge TUN + fake-ip 把 `api.apimart.ai` 解析进
 * `198.18.0.0/15`（RFC 2544 基准测试段），POST 放行、GET 被自己拦下——10 条视频钱扣了、
 * 一帧都取不回来，界面只说「生成失败」。
 *
 * 本模块把那个决策收成**一处**：`classifyOutboundAddresses` 是唯一的判据，
 * `readOutboundEnvironment` 是唯一的环境事实，`check:outbound-policy` 棘轮盯着所有
 * `appFetch` / `isPrivateHost` 的引用点，谁再长出第二个分类器都会报红。
 * 环境事实**在进程内只探一次并缓存**——这正是「一处判定、结果带到取回」：提交那一刻算出的
 * 网络环境，取回时读到的是同一份，不可能中途翻脸。
 *
 * 2026-09-07 第二轮起，**提交侧也走这里**：`vendorHttp.requestVendor` 在发出付费请求之前调
 * `authorizeOutboundDestination`，与取回侧同一个函数、同一份环境事实。用户显式配在模型设置里的
 * vendor origin 仍然可以是私网（本地 ComfyUI / 局域网自建中转是正当配置），但它走的是**声明式
 * 精确 origin 例外**，不是「提交侧不判」——两者的区别是后者对任何目的地都放行。
 * 提交被拦时请求**从未离开本机**，所以供应商没被请求到、不可能计费；文案据此与取回侧分家
 * （取回侧是「钱已付、免费重取」，提交侧是「没扣费、修好网络重新生成」）。
 *
 * ── fake-ip 为什么可以放行（依据，不是宽容）────────────────────────────────────────────
 * `198.18.0.0/15` 由 RFC 2544 §C.2.2 分配给**网络互联设备基准测试**，RFC 5735/6890 把它列为
 * 特殊用途保留段——它不是 RFC 1918 私网，任何真实内网服务都不该住在那里。而 Clash / Surge /
 * sing-box 这类本地代理的 fake-ip 模式**默认就把它当合成地址池**（Clash `fake-ip-range` 默认
 * `198.18.0.1/16`），把每一个域名映射进去，真正的 DNS 由代理在自己那侧做。
 * 也就是说：本机解析器一旦在合成答案，`198.18.x` 就**不是一个可被 SSRF 打到的目的地**，
 * 而是「交给代理去解析」的记号。门岗真正要挡的 `127/8`、`10/8`、`172.16/12`、`192.168/16`、
 * `169.254/16`（云元数据）全部**保持拦截**，一条都不放。
 *
 * 关键在于：放行必须有**阳性证据**，不能因为「用户可能开了代理」就默认放行。
 * 证据取自 `probeSyntheticResolver`：向一个**随机的、不可能存在的域名**发一次 DNS 查询。
 * 正常解析器必答 NXDOMAIN；只有在合成答案的解析器才会给出地址。给出的地址落在 198.18/15 时，
 * 才认定「本机跑着 fake-ip 代理」。探测失败/超时/答不出 → 按**没有**代理处理（fail-closed，维持拦截）。
 *
 * **探测名必须用真实 TLD（.com/.net），不能用 `.invalid`/`.test`/`.example`。** 这一条是在真机上
 * 撞出来的，反直觉且致命：RFC 6761 要求解析器**在本地**就把这些保留 TLD 答成 NXDOMAIN，查询根本
 * 到不了代理。2026-09-07 在用户机器上实测（fake-ip 确实开着，`api.apimart.ai → 198.18.0.140`）：
 *
 *     nomi-fakeip-probe-74rf3q9vwd.com     -> 198.18.2.228   （代理答的，✅ 证据成立）
 *     nomi-fakeip-probe-2xcw16ci3b.net     -> 198.18.2.229   （✅）
 *     nomi-fakeip-probe-gqortvorri.invalid -> ENOTFOUND      （❌ 系统本地答的，探不到代理）
 *     nomi-fakeip-probe-6md3vt5xmq.test    -> ENOTFOUND      （❌）
 *     nomi-fakeip-probe-6tt2saelif.example -> ENOTFOUND      （❌）
 *
 * 换言之，「保证不存在」的名字恰恰因为**太规范**而无法当探针——它规范到根本不出门。随机 .com 标签
 * 撞上真实注册域名的概率可忽略，且即便撞上，真实域名解析出的是公网地址、不在 198.18/15，
 * 不会造成误判。查的是不存在的名字，除 DNS 外不产生任何出站流量。
 *
 * 逃生口：本模块**没有** env 开关。实验室要的 loopback 由 `main.ts` 在 `!app.isPackaged` 时
 * 显式注入精确 origin（`setLabTrustedPrivateOrigins`），打包版本连读都不读——旧的
 * `LAB_ALLOW_LOCALHOST=1` 是把分类器整个关掉（连 169.254 元数据一起放行），已删除。
 */
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { isPrivateHost } from "./networkHostPolicy";

export type ResolvedHostAddress = { address: string; family: 4 | 6 };

/** RFC 2544 基准测试段 = fake-ip 代理的默认合成地址池。 */
const BENCHMARKING_RANGE = { address: "198.18.0.0", prefix: 15 } as const;
const benchmarking = new net.BlockList();
benchmarking.addSubnet(BENCHMARKING_RANGE.address, BENCHMARKING_RANGE.prefix, "ipv4");

/** 合成解析器探测的超时：DNS 是启动路径上的同步依赖，绝不允许它拖住第一次生成。 */
const SYNTHETIC_PROBE_TIMEOUT_MS = 1_500;

export function isBenchmarkingAddress(address: string): boolean {
  return net.isIPv4(address) && benchmarking.check(address, "ipv4");
}

export type OutboundRefusalReason =
  /** URL 里直接写了私网/回环主机名或 IP 字面量。 */
  | "private-host"
  /** 主机名本身公网，但解析结果落在私网/回环。 */
  | "private-address"
  /** 解析不出任何地址。 */
  | "unresolvable";

/**
 * 出站被策略拒绝时的**结构化**错误（不是裸 `new Error(字符串)`）。
 *
 * 为什么必须结构化：验收里这条错误一路被压成「生成失败」，用户面前没有任何线索。下游要能
 * 区分「安全策略拦的」与「上游挂了」，并据此给出**不同的下一步**——前者可以在设置里确认代理
 * 后**免费重新拉取**（任务已付费、上游已成功），后者才需要重试生成。
 */
export class OutboundDestinationRefusedError extends Error {
  readonly reason: OutboundRefusalReason;
  readonly hostname: string;
  /** 触发拒绝的那个地址（`private-host`/`unresolvable` 时为空串）。 */
  readonly observedAddress: string;
  /** 拒绝发生时本机是否被判定为 fake-ip 合成解析器（写进错误，便于事后对账）。 */
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

// ── 环境事实：进程内探一次，提交与取回读同一份 ────────────────────────────────────────

export type OutboundEnvironment = {
  /** 本机解析器在合成答案（fake-ip 代理，含 TUN 透明模式——那种模式下 app 看不到任何代理设置）。 */
  syntheticResolver: boolean;
  /** 探测时观察到的合成地址样本，供设置页状态行与错误文案引用。 */
  syntheticSample: string;
};

const NO_SYNTHETIC_RESOLVER: OutboundEnvironment = { syntheticResolver: false, syntheticSample: "" };

let environmentProbe: Promise<OutboundEnvironment> | null = null;
let lastKnownEnvironment: OutboundEnvironment = NO_SYNTHETIC_RESOLVER;

/** 注入点（测试用）：默认走真实 DNS。 */
export type SyntheticResolverProbe = (hostname: string) => Promise<readonly ResolvedHostAddress[]>;

let probeImpl: SyntheticResolverProbe = async (hostname) => {
  const resolved = await dnsLookup(hostname, { all: true, verbatim: true });
  return resolved.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
};

/** 探针 TLD：必须是**真实可路由**的 TLD，理由见文件头的实测表。两个是为了容忍单个 TLD 的解析异常。 */
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
 * 解析器答得出地址 = 它在合成；地址落在 198.18/15 = 那是 fake-ip 池。
 * 任何异常（NXDOMAIN / 超时 / 无网络）都按「没有合成解析器」返回——fail-closed，维持拦截。
 */
async function probeSyntheticResolver(): Promise<OutboundEnvironment> {
  for (const tld of PROBE_TLDS) {
    try {
      const addresses = await lookupWithTimeout(probeHostname(tld));
      const synthetic = addresses.find((entry) => isBenchmarkingAddress(entry.address));
      if (synthetic) return { syntheticResolver: true, syntheticSample: synthetic.address };
    } catch {
      // NXDOMAIN 是**正常解析器**的正确答案，继续问下一个 TLD；两个都没给出合成地址才收工。
    }
  }
  return NO_SYNTHETIC_RESOLVER;
}

/**
 * 读环境事实。**同一进程内只探一次**：提交那一刻的判定与取回那一刻的判定必须是同一个，
 * 否则「提交放行、取回拒绝」的不对称会以另一种形式回来。
 */
export async function readOutboundEnvironment(): Promise<OutboundEnvironment> {
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
 * IP 字面量拿不到 fake-ip 豁免——用户直接写 `http://198.18.0.5/` 时没有任何域名可供代理解析，
 * 那就是在指一个具体地址，按地址判。
 */
function isProxyResolvableName(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host || net.isIP(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  return host.includes(".");
}

/**
 * 共用判据：一组已解析地址能不能出站。
 *
 * 放行 198.18/15 需要**同时**满足三条：① 本机确证在跑 fake-ip 合成解析器；② 目标是可被代理
 * 解析的公网域名（不是 IP 字面量）；③ 该地址本身就在合成池里。缺一条即维持拦截。
 */
export function classifyOutboundAddresses(input: {
  hostname: string;
  addresses: readonly ResolvedHostAddress[];
  environment: OutboundEnvironment;
}): OutboundVerdict {
  const { hostname, addresses, environment } = input;
  if (!addresses.length) return { allowed: false, reason: "unresolvable", observedAddress: "" };
  const proxySideResolution = environment.syntheticResolver && isProxyResolvableName(hostname);
  for (const entry of addresses) {
    if (!isPrivateHost(entry.address)) continue;
    if (proxySideResolution && isBenchmarkingAddress(entry.address)) continue;
    return { allowed: false, reason: "private-address", observedAddress: entry.address };
  }
  return { allowed: true };
}

/** 把一个地址折成可安全展示的粗粒度前缀（错误文案/日志用，不泄露完整内网地址）。 */
export function coarseAddressLabel(address: string): string {
  if (!net.isIPv4(address)) return address;
  const octets = address.split(".");
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.x.x` : address;
}

// ── 单一入口：任何出站在**发出之前**都问这一次 ──────────────────────────────────────

/**
 * 这次出站的 TCP 连接由谁去开。
 *  · `direct` = Nomi 自己开连接，所以**本机解析出的地址就是这次连接会用的地址**，可判、可 pin。
 *  · `proxy`  = 应用级或单供应商的 HTTP/SOCKS 代理替我们开连接，**DNS 在代理那侧做**，
 *               本机解析出的东西不是这次连接会用的那份，拿它判等于判了一个不存在的目的地。
 */
export type OutboundRouteKind = "direct" | "proxy";

/** 这次出站是「花钱那一步」还是「拿东西那一步」——两者被拦时用户该做的事完全不同。 */
export type OutboundStage = "submit" | "retrieval";

export type OutboundAuthorization =
  | { allowed: true; route: OutboundRouteKind; pinnedAddresses: readonly ResolvedHostAddress[] | null }
  | {
      allowed: false;
      reason: OutboundRefusalReason;
      hostname: string;
      observedAddress: string;
      syntheticResolver: boolean;
    };

/**
 * 链路本地段（IPv4 169.254/16、IPv6 fe80::/10）。**任何显式声明的 origin 都买不通它。**
 *
 * 为什么单独拎出来：其余私网段（127/8、10/8、192.168/16）是用户真会自己跑服务的地方——
 * 本地 ComfyUI、局域网里的 LM Studio、自建中转，声明成供应商是完全正当的配置。而 169.254.169.254
 * 是云主机的**元数据通道**，没有任何供应商住在那儿，它唯一的用途是把凭证读出来。出站请求带着
 * 用户的 API Key，声明式白名单一旦覆盖到这一段，就等于给「把 Key 发去元数据端点」发了张许可证。
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
 * **出站授权的唯一入口**（提交侧与取回侧都走这一个函数，这就是「同一个分类器、同一份环境事实」）。
 *
 * ── 为什么「代理生效」这个条件必须住在这里，而不是住在调用点（P1 逃生口，R28）──────
 * 先把上一轮的形状说准，别把它讲得比实际更糟：hardenedFetch 的 `assertSafeUrl` 在**每条路由上**
 * 都判过名字（`isPrivateHost`），代理生效时跳过的是**地址层**（解析 + 地址分类）。跳过地址层本身
 * 是对的（见下），真正的毛病是另外两条：
 *   ① 名字层的判据长在调用点自己身上——`isPrivateHost` + 它自己那份 origin 例外，
 *      于是「哪些目的地能出站」有了第二个 owner（这正是 check:outbound-policy 规则 3 在数的东西）；
 *   ② `if (!applicationProxyActive())` 这个条件写在调用点，代理语义就散在调用点上。
 *      下一条出站路径照抄这个 if，owner 就又分裂成两份，也就是下一次「提交放行、取回拒绝」。
 *   ③ 副作用：调用点那份 origin 例外对 `169.254` 一视同仁——用户（或一条恶意配置）把元数据地址
 *      声明进来就能买通它。判据收进来之后 `isLinkLocalHost` 让它买不通。
 *
 * 正确的形状是：owner 每一跳都被问到，条件住在 owner 里，**判据的对象随路由换**——
 *   · direct：判「本机解析出的地址」，并把地址交回去 pin 住（防解析后重绑）。
 *   · proxy ：判「名字」。代理在它那侧解析，本机解析结果不是这次连接会用的那份；
 *             拿它当判据正是 2026-09-06 的病根（fake-ip 合成地址被当成内网目的地）。
 *             名字层仍然是真判据：IP 字面量私网、localhost/.local 一律拒——**不是不判，是判名字**。
 *
 * 先查别人（详见 docs/plan/2026-09-07-model-generation-core-path.md「先查别人（第二轮）」）：
 *   · GitLab 撞过一模一样的题（<https://gitlab.com/gitlab-org/gitlab/-/work_items/378267>：不能解析
 *     域名的自建实例配了代理后，GitHub Import 全挂）。他们的处置是**整段关掉** DNS 重绑保护：
 *     `Gitlab.http_proxy_env?` 为真就跳过检查。我们取它把「判目的地」和「选路由」合成一次决策的
 *     方向，**不取**它的整段关闭——整段关闭正是本轮要拆掉的那种逃生口。
 *   · Stripe smokescreen 是另一种同族解法：把分类**下沉到代理层**，由那台 CONNECT 代理统一解析并
 *     拒绝内网地址（<https://github.com/stripe/smokescreen/blob/master/README.md>）。桌面端没有那
 *     一层可下沉——代理是用户自己的 Clash/Surge，我们管不着，所以名字层必须自己判。
 *   · 「代理路由下该判名字」不是我们的发明，是 SOCKS5 的既定语义：curl 的 `--socks5` 本机解析、
 *     `--socks5h`/`--socks5-hostname` 交给代理解析（<https://curl.se/docs/manpage.html#--socks5-hostname>）。
 *     代理解析时本机那份答案根本不参与连接——拿它当判据，判的就是一个不存在的目的地。
 */
export async function authorizeOutboundDestination(input: {
  url: URL;
  route: OutboundRouteKind;
  /** 懒读：名字层就能定案时不触发 DNS 探针（本地 ComfyUI 那种回环取片不该为它等 1.5s）。 */
  readEnvironment: () => Promise<OutboundEnvironment>;
  resolve: (hostname: string) => Promise<readonly ResolvedHostAddress[]>;
  /** 用户**显式声明**的私网 origin（供应商 baseUrl / 已配置的本地 ComfyUI / 实验室夹具）。 */
  declaredOrigins?: readonly string[];
}): Promise<OutboundAuthorization> {
  const { url, route, readEnvironment, resolve } = input;
  const hostname = connectionHostname(url.hostname);
  const declared = [...(input.declaredOrigins || []), ...labTrustedPrivateOrigins];
  // 名字层（两条路由都判）。声明式例外只对**非链路本地**的私网生效，理由见 isLinkLocalHost。
  if (isPrivateHost(url.hostname)) {
    if (isLinkLocalHost(hostname) || !matchesDeclaredOrigin(url, declared)) {
      return {
        allowed: false,
        reason: "private-host",
        hostname,
        observedAddress: "",
        syntheticResolver: lastKnownEnvironment.syntheticResolver,
      };
    }
    // 声明过的私网服务：单跳直连，不 pin（没有第三方能改这个 origin 的解析结果）。
    return { allowed: true, route, pinnedAddresses: null };
  }
  // 代理路由到此为止：地址层的判据在代理那侧，我们手上没有它，**如实承认**比拿错的地址装作判过了强。
  if (route === "proxy") return { allowed: true, route, pinnedAddresses: null };
  // 地址层（只有 direct 路由有意义）。
  const environment = await readEnvironment();
  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolve(hostname);
  const verdict = classifyOutboundAddresses({ hostname, addresses, environment });
  if (!verdict.allowed) {
    return {
      allowed: false,
      reason: verdict.reason,
      hostname,
      observedAddress: verdict.observedAddress,
      syntheticResolver: environment.syntheticResolver,
    };
  }
  return { allowed: true, route, pinnedAddresses: addresses };
}
