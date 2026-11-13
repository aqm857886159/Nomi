// 凭据解析顺序：
//   bearer token：官方 `npx wrangler auth token --json`（由 Wrangler 自己处理
//     macOS/Linux/Windows 的配置、keyring、旧目录优先级与 OAuth refresh）。
//   账号 id：NOMI_CF_ACCOUNT_ID 环境变量 → 没设就解析 `npx wrangler whoami`。
// 两者都拿不到就抛——错误文案只说下一步，不带任何值。

import { execFileSync } from 'node:child_process'
import { fetchWithRetry } from '../transientRetry.mjs'

/** 三种货物的桶前缀。与 infra/feedback-worker/src/worker.mjs 的路由名一一对应
 *  （`/v1/feedback` → `feedback/`，以此类推）——那份文件是唯一真相源，这里只是抄它已经
 *  公开在 infra/feedback-worker/wrangler.jsonc 里的桶名，不是新引入的敏感信息。 */
export const INTAKE_BUCKET = 'nomi-feedback-intake'
export const INTAKE_PREFIXES = ['feedback/', 'events/']

/** 从官方 `wrangler auth token --json` 输出取 bearer token；不接受 API key/email。 */
export function parseWranglerAuthToken(text) {
  try {
    const value = JSON.parse(String(text || ''))
    return value && typeof value.token === 'string' ? value.token : ''
  } catch {
    return ''
  }
}

/**
 * 让 Wrangler 自己处理三平台的配置、keyring 与 OAuth refresh。**只在内存里用**，
 * 绝不打印、不落盘；错误不带命令输出，避免底层 stderr 意外回显 token。
 */
export function authTokenFromWrangler({ execImpl } = {}) {
  const run = execImpl ?? ((cmd, args) => execFileSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
    shell: true,
  }))
  let output
  try {
    output = run('npx', ['wrangler', 'auth', 'token', '--json'])
  } catch (err) {
    const timedOut = err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM' || err?.killed
    if (err instanceof Error) {
      err.message = 'wrangler command failed'
      err.stack = undefined
      delete err.stdout
      delete err.stderr
      delete err.output
    }
    if (timedOut) {
      throw new Error('跑不动 `npx wrangler auth token --json`：超时（20 秒）——若登录已过期或未登录，跑 `npx wrangler login` 后重试。', { cause: err })
    }
    throw new Error('wrangler 登录已过期（或没登录）——跑 `npx wrangler login` 后重试。', { cause: err })
  }
  const token = parseWranglerAuthToken(output)
  if (!token) throw new Error('wrangler 登录已过期（或没登录）——跑 `npx wrangler login` 后重试。')
  return token
}

/** 从 `wrangler whoami` 的输出里挑账号 id。Cloudflare 账号 id 是 32 位小写十六进制——
 *  账号名/邮箱不会长这样，取第一个匹配就够，不用解析表格结构。纯函数、可测。 */
export function parseAccountIdFromWhoami(output) {
  const m = /\b[0-9a-f]{32}\b/.exec(String(output || ''))
  return m ? m[0] : ''
}

/** 跑 `npx wrangler whoami` 拿账号 id。**只在内存里用**，调用方不许打印这个函数的输出。
 *
 * `shell: true` 是必须的，不是可省的花架子：Windows 上 `npx` 是 `npx.cmd`（shell 垫片），
 * `execFileSync` 不带 shell 时按字面找一个叫 `npx` 的可执行文件，找不到就是 ENOENT——
 * 2026-09-29 第一次真实运行就是这么炸的（实测复现）。`cmd`/`args` 都是硬编码字面量，
 * 没有任何调用方可控的输入拼进命令行，走 shell 没有注入面。 */
export function whoamiAccountId({ execImpl } = {}) {
  const run = execImpl ?? ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 20_000, shell: true }))
  let output
  try {
    output = run('npx', ['wrangler', 'whoami'])
  } catch (err) {
    const timedOut = err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM' || err?.killed
    if (err instanceof Error) {
      err.message = 'wrangler command failed'
      err.stack = undefined
      delete err.stdout
      delete err.stderr
      delete err.output
    }
    if (timedOut) {
      throw new Error('跑不动 `npx wrangler whoami`：超时（20 秒）——若登录已过期或未登录，跑 `npx wrangler login` 后重试；也可设 NOMI_CF_ACCOUNT_ID。', { cause: err })
    }
    throw new Error('跑不动 `npx wrangler whoami`：命令启动失败——若登录已过期或未登录，跑 `npx wrangler login` 后重试；也可设 NOMI_CF_ACCOUNT_ID。', { cause: err })
  }
  const accountId = parseAccountIdFromWhoami(output)
  if (!accountId) throw new Error('`npx wrangler whoami` 的输出里解不出账号 id——先确认已 `npx wrangler login`，或直接设 NOMI_CF_ACCOUNT_ID。')
  return accountId
}

/**
 * 解析这一轮要用的凭据。账号 id 与 token 都只回内存里的值，调用方负责不打印、不落盘、
 * 不写进任何报告——`main()` 里过一遍代码检查这条约束就够，这里只是提供值。
 */
export function resolveCredentials({ env = process.env, execImpl } = {}) {
  const token = authTokenFromWrangler({ execImpl })
  const fromEnv = String(env.NOMI_CF_ACCOUNT_ID || '').trim()
  const accountId = fromEnv || whoamiAccountId({ execImpl })
  return { accountId, token }
}

function objectsApi(accountId, prefixOrPath) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${INTAKE_BUCKET}${prefixOrPath}`
}

/**
 * 列出某个前缀下的全部键。分页上限 200 页（每页 1000 条）——与 intake-pull.mjs 一致，
 * 现网量级（几百条）几页就翻完，200 只是防御性上限，不是预期路径。
 * **失败必须抛**：调用方把它翻译成「今天没查成」，不许静默当成「没有新数据」。
 */
export async function listAllKeys({ accountId, token, prefix, fetchImpl }) {
  const out = []
  let cursor = ''
  for (let page = 0; page < 200; page += 1) {
    const q = new URLSearchParams({ prefix, per_page: '1000' })
    if (cursor) q.set('cursor', cursor)
    const res = await fetchWithRetry(objectsApi(accountId, `/objects?${q}`), { headers: { Authorization: `Bearer ${token}` } }, { fetchImpl })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.success === false) {
      throw new Error(`列 ${prefix} 失败：HTTP ${res.status} ${JSON.stringify(body.errors || []).slice(0, 300)}`)
    }
    for (const o of body.result || []) out.push(o.key)
    cursor = body.result_info?.cursor || ''
    if (!body.result_info?.is_truncated || !cursor) break
  }
  return out
}

/** 取单个对象的原始字节。key 里的 `/` 是路径分隔符，不是要编码的字符——照 intake-pull.mjs
 *  的写法把 encodeURIComponent 编过的 `%2F` 换回来，不然 URL 会把整个 key 当成一段文件名。 */
export async function getObjectBuffer({ accountId, token, key, fetchImpl }) {
  const encoded = encodeURIComponent(key).replace(/%2F/g, '/')
  const res = await fetchWithRetry(objectsApi(accountId, `/objects/${encoded}`), { headers: { Authorization: `Bearer ${token}` } }, { fetchImpl })
  if (!res.ok) throw new Error(`取 ${key} 失败：HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
