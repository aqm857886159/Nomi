// 反馈回路的**唯一**出站口。三种货物（用量事件 / Agent 轨迹 / 一键反馈）都从这里走。
//
// 2026-09-15：这份文件替掉了 `aptabaseAdapter.ts`（P1 加新必删旧）。
// 为什么不继续用 Aptabase（它的隐私姿态恰恰是同类里最干脆的，理由不是它不好）：
//
//   用量事件是 5 个名字 + 枚举 props，「我们不收别的」是**肉眼可验**的；
//   这一版开始收 Agent 轨迹，「不收别的」就变成一句**只能靠承诺的话**。
//   一句只能靠承诺的话，不能让第三方进程替我们说。
//
// 所以传输这一格自建（`infra/feedback-worker/`），而白名单校验、同意合同、脱敏、
// 落盘发件箱全部沿用仓库里 2026-09-06 就建好的那套，一行没重写。
//
// 与 `telemetrySettings.ts` 的分工：那份管**用户同意了没有**（合同、时间、匿名会话 id），
// 这份管**东西往哪发**（端点、令牌、超时）。两件事会各自独立变化——换域名不该碰同意合同，
// 改同意语义不该碰 HTTP——所以不合在一个文件里。
import fs from 'node:fs'
import path from 'node:path'
import { appFetch } from '../appFetch'

/**
 * 出厂配置：打包时由 `scripts/write-intake-config.mjs` 烤进 `dist-electron/intake-config.json`。
 *
 * 为什么不能只读 `process.env`（2026-09-17，W-01）：装机版的 `process.env` 是**用户桌面的环境**，
 * 那里永远没有这两个值。0.21.0 就是这么出厂的——链路通、走查绿（走查自己在 env 里塞值），
 * 用户却「点了愿意、写了反馈、拿到编号，然后谁也没收到」。
 *
 * 读的顺序是 env 优先、烤进来的兜底：走查与自部署验证靠 env 指向本机接收端，
 * 出厂包靠烤进来的那份。读失败（开发期还没 build、文件被删）一律当「未配置」，
 * 不抛——反馈回路坏掉不该让主进程起不来。
 */
type BakedIntakeConfig = { endpoint: string; token: string }

/**
 * 烤进来的那份配置在哪。**导出**是为了让测试与门岗指向同一条路径——
 * 抄一份路径过去就是第二个真相源，挪了目录之后测试仍然绿、包却读不到。
 * 本文件编译到 `dist-electron/telemetry/`，配置在 `dist-electron/` 根上。
 */
export function intakeConfigPath(): string {
  return path.join(__dirname, '..', 'intake-config.json')
}
let bakedCache: BakedIntakeConfig | null = null
function baked(): BakedIntakeConfig {
  if (bakedCache) return bakedCache
  bakedCache = { endpoint: '', token: '' }
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(intakeConfigPath(), 'utf8'))
    if (raw && typeof raw === 'object') {
      const record = raw as Record<string, unknown>
      bakedCache = {
        endpoint: typeof record.endpoint === 'string' ? record.endpoint : '',
        token: typeof record.token === 'string' ? record.token : '',
      }
    }
  } catch { /* 未配置 —— 见上面那段。 */ }
  return bakedCache
}

/** 只给测试用：让下一次读重新走一遍盘。 */
export function resetIntakeConfigCache(): void {
  bakedCache = null
}

/** 接收端的三条路由。写成联合类型而不是 string：新增一条货物必须来这里登记一次。 */
export type IntakeRoute = '/v1/events' | '/v1/trajectories' | '/v1/feedback'

export type IntakeResult = {
  /** 只有 /v1/feedback 会给：用户能口述的编号 NF-MMDD-NNNN。 */
  id?: string
  /** 接收端的主键（uuid）。排查时用它精确定位一条。 */
  ref?: string
  accepted?: number
}

export type IntakeFetch = typeof globalThis.fetch

const DEFAULT_TIMEOUT_MS = 8_000

/**
 * 令牌。**它不是密钥，是发布令牌**——随打好的 App 一起发出去，解包就能拿到。
 * 它挡的是随手扫到这个 URL 的机器人，不是定向滥用；所以接收端只能写、不能读/列/删
 * （见 `infra/feedback-worker/README.md` 的「三条要诚实说清的事」）。
 * 任何地方都不要把它说成「已鉴权」。
 */
export function intakeToken(): string {
  // env 只要**被定义**就赢（哪怕是空串）：走查靠 `NOMI_INTAKE_*=''` 显式关掉出厂端点，
  // 用 `||` 会让空串掉回烤进来的那份，把「验证只在本机记录」那条走查变成假绿。
  return String(process.env.NOMI_INTAKE_TOKEN ?? baked().token).trim()
}

/** 回环地址：http 在这里是允许的，因为这些字节根本没离开这台机器。 */
const LOOPBACK_HOST = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d+)?$/i

/**
 * 端点基址。**https，或者回环上的 http**。
 *
 * 为什么卡 https：这三种货物里有工具名、模型 id 和用户勾选带上的文稿，明文 http
 * 等于把它们交给路上任何人。配了明文远端就当没配——静默降级成「只在本机记录」，
 * 比「照发但不加密」诚实。
 *
 * 为什么给回环开口子：走查与自部署验证都要往 `http://127.0.0.1:<port>` 发一次真请求。
 * 逼它们弄自签证书，换来的不是安全而是「走查里干脆别发真请求」——那会让整条链
 * 从此只有单测覆盖。回环流量不出网卡，加密保护的是不存在的中间人。
 *
 * 这条判据顺带就是 `check:outbound-policy` 基线里那一行的理由：端点来自**我们自己打包时
 * 注入的环境变量**，从来不是用户/Agent/供应商给的 URL，所以它不需要过目的地策略；
 * 而回环这个口子也正是 `hardenedFetch` 会挡掉、我们却必须留着的那一格。
 */
export function intakeEndpoint(): string | null {
  const configured = String(process.env.NOMI_INTAKE_ENDPOINT ?? baked().endpoint).trim().replace(/\/+$/, '')
  if (!configured) return null
  if (/^https:\/\//i.test(configured)) return configured
  const loopback = /^http:\/\/([^/?#]+)$/i.exec(configured)
  return loopback && LOOPBACK_HOST.test(loopback[1]) ? configured : null
}

/** 端点和令牌都得有。缺一个就是「未配置」——设置页据此显示「只在本机记录」。 */
export function intakeConfigured(): boolean {
  return intakeEndpoint() !== null && intakeToken().length > 0
}

/**
 * 发一份货物。成功回接收端给的 `{id?, ref?, accepted?}`，失败抛——**调用方负责入队重试**，
 * 这里不自己重试：重试策略在三种货物上不一样（用量攒批、反馈立刻发），
 * 塞进传输层就得长出分支，而分支正是「哪条路没重试」这种 bug 的住处。
 */
export async function postIntake(
  route: IntakeRoute,
  payload: unknown,
  deps: { fetch?: IntakeFetch; endpoint?: string | null; token?: string; timeoutMs?: number } = {},
): Promise<IntakeResult> {
  const endpoint = deps.endpoint === undefined ? intakeEndpoint() : deps.endpoint
  const token = deps.token ?? intakeToken()
  if (!endpoint || !token) throw new Error('Nomi intake endpoint is not configured')

  // `AbortSignal.timeout` 替掉手写的 AbortController + setTimeout + finally clearTimeout：
  // 同一件事，少三处可以忘的清理。超时/网络错都直接往上抛（fetch 与 AbortSignal 抛的本来就是
  // Error 子类），调用方只需要知道「没发出去，入队重试」。
  const response = await (deps.fetch ?? appFetch)(`${endpoint}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    // 反馈回路永远不该带 cookie：带了就等于给了一个跨请求可关联的身份，
    // 而我们对用户说的是「匿名」。
    credentials: 'omit',
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Nomi intake HTTP ${response.status}`)
  // 接收端回的是 JSON，但网关/代理可能插一页 HTML。解不出来不算失败——
  // 200 已经说明收到了，编号拿不到只是少一个把手。
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
    const record = body as Record<string, unknown>
    return {
      ...(typeof record.id === 'string' ? { id: record.id } : {}),
      ...(typeof record.ref === 'string' ? { ref: record.ref } : {}),
      ...(Number.isInteger(record.accepted) ? { accepted: Number(record.accepted) } : {}),
    }
  } catch {
    return {}
  }
}
