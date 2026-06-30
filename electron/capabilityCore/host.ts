// 能力核 · headless host（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S5）。
//
// 「Nomi 关着」时的执行体：一个**无窗口的 Electron 进程**（不是纯 node——生成链路要 safeStorage 解密
// vendor key、app.getPath 取数据根，纯 node 够不着）。CLI 探测到 app 没开 → spawn `electron host.js`，
// 经 stdin/argv 收一条命令，调能力核（B 模式直写 project.json），把结果打到 stdout(JSON) 后退出。
//
// 关键：host **不取单实例锁**（它是 worker 不是 app），也不开窗、不起 RPC、不写实例广告——它是一次性
// 短命进程。app 关着时它就是工程文件的唯一写者（安全）；app 开着时 CLI 走 RPC 不会 spawn 它（无并发写）。
import path from 'node:path'
import { app, session } from 'electron'

import { dispatch, RpcError } from './dispatcher'
import { createDiskGateway } from './gateway'
import { ensureBuiltinModelSeeds } from '../catalog/catalogStore'
import { runTask, fetchTaskResult } from '../runtime'
import { verifyToken } from './security'
import { applySystemProxy } from '../systemProxy'

// 身份对齐（解密 vendor key 的前提）：CLI 用 `electron host.js` spawn 时 getName 默认 "Electron"，与主 app
// 加密 safeStorage key 时的身份不符 → 解不开 key（真机实测「API key missing」根因）。spawner 经 NOMI_APP_NAME
// 传入主 app 身份（= package.json name），setName 对齐 keychain + 默认 userData 才能读到真 catalog 并解密。
// 必须在 app ready 前调。生产（host 在打包 app 内、getName 已是产品名）spawner 不传此 env → 不覆盖。
// setName 只对齐 keychain 身份（safeStorage 解密）；userData 路径却**不一定**跟着改——实测 dev host
// 偶发 userData 仍解析到 "Electron"（getPath 缓存 / setName 时机），导致读到空目录 → 项目/目录/密钥全
// 「不存在」（接入测试踩到的 headless 偶发坑）。故显式 setPath 钉死 userData=<appData>/<name>，与主 app
// 同源、确定不漂。getPath('appData') 在 ready 前可用，setPath 在 ready 前调生效。
if (process.env.NOMI_APP_NAME) {
  app.setName(process.env.NOMI_APP_NAME)
  try {
    app.setPath('userData', path.join(app.getPath('appData'), process.env.NOMI_APP_NAME))
  } catch {
    /* setPath 失败 → 退回 setName 默认行为 */
  }
}

type HostCommand = { token?: string; method?: string; params?: Record<string, unknown> }

function readCommandFromArgv(): HostCommand {
  // electron host.js --cmd '<json>'
  const flagIndex = process.argv.indexOf('--cmd')
  if (flagIndex >= 0 && process.argv[flagIndex + 1]) {
    try {
      return JSON.parse(process.argv[flagIndex + 1]) as HostCommand
    } catch {
      return {}
    }
  }
  return {}
}

function emit(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload))
}

async function run(): Promise<number> {
  const command = readCommandFromArgv()
  // 即便本机直连，host 仍要求 token——外部进程想驱动它必须证明拿到了用户机器上的 token（S6）。
  if (!verifyToken(command.token)) {
    emit({ ok: false, error: '鉴权失败：token 无效' })
    return 1
  }
  const method = String(command.method || '')
  const params = command.params && typeof command.params === 'object' ? command.params : {}
  // headless 永远是工程文件的唯一写者（app 关着时 CLI 才 spawn 它），无运行中渲染层 → 恒磁盘网关。
  try {
    const result = await dispatch(method, params, { runTask, fetchTaskResult, makeGateway: createDiskGateway })
    emit({ ok: true, result })
    return 0
  } catch (error) {
    const message = error instanceof RpcError ? error.message : error instanceof Error ? error.message : String(error)
    emit({ ok: false, error: message })
    return 1
  }
}

app.whenReady().then(async () => {
  let code = 1
  try {
    // 和主 app 一致设代理(main.ts:436):headless host 默认 session 不设代理 → 代理后的机器 vendor fetch 失败。
    // 失败兜底直连(不崩),与主 app 同一不变量。
    try {
      await applySystemProxy(session.defaultSession)
    } catch {
      /* 代理设失败 → 直连兜底 */
    }
    // 内置种子对账（与主 app 启动 main.ts 同一步）：headless 此前从不调它 → 代码改了 curated mapping 后只有
    // 开过 GUI 才同步，纯 MCP/CLI 用户跑旧目录。幂等：无变化不写盘、atomic 写。userData 由顶部 setPath 钉死同源。
    try {
      ensureBuiltinModelSeeds()
    } catch (error) {
      process.stderr.write(`seed reconcile failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
    code = await run()
  } catch (error) {
    emit({ ok: false, error: error instanceof Error ? error.message : String(error) })
  } finally {
    app.exit(code)
  }
})
