// 核心冒烟场景的「环境依赖」登记表（单一 owner）。
//
// 场景在 CORE_SMOKE_SCENARIOS 里用 `needs: [...]` 声明自己要什么环境；夹具在**每一种夹具**下
// 按这里的 provisioner 把它们准备好。写了这里没有的键 → runner 起进程之前就报「缺依赖」而红，
// 不静默跳过（跳过就是「登记即放绿」，R17）。
//
// 加一条依赖：在 CORE_SMOKE_NEEDS 里加一项（requires 写它依赖的别的键），并在
// tests/ux/core-smoke/core-smoke.test.mjs 里补一条它真的把环境准备好的断言。
import fs from 'node:fs'
import path from 'node:path'

import {
  createAgentRuntimeFixture, FIXTURE_APIMART_API_KEY, FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR,
  FIXTURE_TEXT_MODEL, FIXTURE_VENDOR,
} from '../agent-runtime-fixture.mjs'

/** 执行侧那三把钥匙（同 `agent-runtime-walk-support.mjs:418-424`）。不点名供应商 = apimart。 */
const PAID_ROUTE_ENV = (fixture) => ({
  NOMI_TEST_NETWORK_GUARD: '1',
  NOMI_E2E_PRODUCTION_FIXTURE: '1',
  NOMI_E2E_FIXTURE_BASE_URL: fixture.baseURL,
  NOMI_E2E_FIXTURE_API_KEY: FIXTURE_APIMART_API_KEY,
  NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: fixture.baseURL }]),
})

/**
 * provision({ repoRoot, settingsDir, handles }) → { handle, localStorage?, env?, close? }
 * - handle：交给走查用的句柄（smoke.needs.<id>）
 * - localStorage：App 自己的本机偏好键（经 launchNomiApp 的 initialLocalStorage 写进首个文档之前）
 * - env：主进程要的环境变量（launchNomiApp 的 env）。**只有主进程读得到的口子写在这里**，
 *   不是所有环境都能用 localStorage 表达（生成执行侧那三把钥匙就是例子）。
 * - close：走查结束时释放（服务器、端口）
 */
export const CORE_SMOKE_NEEDS = Object.freeze({
  // 零额度的 loopback 供应商：真 HTTP 服务器 + 写进隔离 settings 的模型目录（agent-runtime-fixture.mjs）。
  loopbackProvider: Object.freeze({
    requires: Object.freeze([]),
    /**
     * `options.fixture`：调用方要的夹具档位（如全功能走查的 `usage: 'measured'`），原样交给
     * `createAgentRuntimeFixture`。核心冒烟不传——一个字节都不变。
     */
    async provision({ repoRoot, settingsDir, userDataDir, appName, needs, options }) {
      // profile-copy 夹具里 settings 是用户真实资料的**拷贝**，已经有目录文件；
      // fixture 以 wx 写入（绝不覆盖），所以先把拷贝里那份挪开——原库从来不被碰到。
      const catalog = path.join(settingsDir, 'model-catalog.json')
      if (fs.existsSync(catalog)) fs.renameSync(catalog, path.join(settingsDir, 'model-catalog.profile-copy-original.json'))
      // 场景自己声明要不要「能真提交的生成路」。声明了才种内置档案那一片 + 开执行侧那三把钥匙，
      // 没声明的场景（只聊天的那些）一个字节都不变。
      const paid = Array.isArray(needs) && needs.includes('paidGenerationRoute')
      const fixture = await createAgentRuntimeFixture({
        ...(options?.fixture ?? {}),
        rootDir: repoRoot, settingsDir,
        ...(paid ? { generationProvider: 'apimart', userDataDir, appName } : {}),
      })
      return {
        handle: fixture,
        close: () => fixture.close(),
        ...(paid ? { env: PAID_ROUTE_ENV(fixture) } : {}),
      }
    },
  }),
  /**
   * 「能真按下去的那条生成路」。
   *
   * 为什么它不是 `loopbackProvider` 自带的：目录里有这家、有凭据、有已发布执行，**还不够**——
   * 主进程装配可提交的生成供应商走的是 `NOMI_E2E_PRODUCTION_FIXTURE` 那个只认 loopback 的口子
   * （`generationProviderBootstrap.ts:70-90` 的三把钥匙：开关 / 地址 / key，少一把就装不出执行器）。
   * 2026-09-22 登记花钱冒烟时实测：少了它们，卡出得来、价也算得出，一按确认宿主回
   * `generation_not_started`（`Provider agent-runtime-loopback lacks required recovery capabilities:
   * configured_provider`）。
   *
   * 为什么走 apimart 档案而不是 loopback 那家自己：`agent-runtime-loopback` 在目录里是
   * `openai-compatible`，它的生成端点同步回图、不回 task id，提交层会判成
   * `SubmissionReceiptUnknownError: ... did not return a task id`（实测）。夹具里能真跑完一单的是
   * 内置 apimart 档案那条异步路——七条 spend 走查用的也都是它。
   */
  paidGenerationRoute: Object.freeze({
    requires: Object.freeze(['loopbackProvider']),
    async provision({ handles }) {
      return { handle: { vendorKey: FIXTURE_APIMART_VENDOR, modelKey: FIXTURE_APIMART_MODEL, loopback: handles.loopbackProvider } }
    },
  }),
  // Agent 默认文本模型 = fixture 文本模型（App 自己的偏好键 nomi.assistantModel，见 src/workbench/ai/assistantModelPref.ts）。
  fixtureTextModel: Object.freeze({
    requires: Object.freeze(['loopbackProvider']),
    async provision({ handles }) {
      const value = { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL }
      return { handle: { ...value, loopback: handles.loopbackProvider }, localStorage: { 'nomi.assistantModel': JSON.stringify(value) } }
    },
  }),
})

/** 声明是否都认得、依赖是否写全。返回问题列表（空 = 合法）。 */
export function checkNeeds(needs, registry = CORE_SMOKE_NEEDS) {
  const problems = []
  if (!Array.isArray(needs)) return ['needs 必须是数组']
  for (const id of needs) {
    const entry = registry[id]
    if (!entry) {
      problems.push(`缺依赖：「${id}」没有 provisioner（已登记：${Object.keys(registry).join(', ')}）`)
      continue
    }
    for (const required of entry.requires) {
      if (!needs.includes(required)) problems.push(`缺依赖：「${id}」需要「${required}」，场景没声明`)
    }
  }
  if (new Set(needs).size !== needs.length) problems.push(`needs 有重复：${needs.join(', ')}`)
  return problems
}

/** 按依赖顺序准备。任何一步失败都先释放已准备的，再把错误抛出去（让走查红）。 */
export async function provisionNeeds(needs, { repoRoot, settingsDir, userDataDir, appName, registry = CORE_SMOKE_NEEDS, options = {} }) {
  const problems = checkNeeds(needs, registry)
  if (problems.length) throw new Error(problems.join('\n'))
  const ordered = []
  const visit = (id) => {
    if (ordered.includes(id)) return
    for (const required of registry[id].requires) visit(required)
    ordered.push(id)
  }
  for (const id of needs) visit(id)
  const handles = {}
  const localStorage = {}
  const env = {}
  const closers = []
  try {
    for (const id of ordered) {
      const result = await registry[id].provision({ repoRoot, settingsDir, userDataDir, appName, handles, needs: ordered, options })
      handles[id] = result.handle
      Object.assign(localStorage, result.localStorage ?? {})
      Object.assign(env, result.env ?? {})
      if (result.close) closers.push(result.close)
    }
  } catch (error) {
    for (const close of closers.reverse()) await Promise.resolve(close()).catch(() => undefined)
    throw error
  }
  return {
    handles,
    localStorage,
    env,
    close: async () => {
      for (const close of closers.reverse()) await Promise.resolve(close()).catch(() => undefined)
    },
  }
}
