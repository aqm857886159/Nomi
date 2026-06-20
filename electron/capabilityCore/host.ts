// 能力核 · headless host（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S5）。
//
// 「Nomi 关着」时的执行体：一个**无窗口的 Electron 进程**（不是纯 node——生成链路要 safeStorage 解密
// vendor key、app.getPath 取数据根，纯 node 够不着）。CLI 探测到 app 没开 → spawn `electron host.js`，
// 经 stdin/argv 收一条命令，调能力核（B 模式直写 project.json），把结果打到 stdout(JSON) 后退出。
//
// 关键：host **不取单实例锁**（它是 worker 不是 app），也不开窗、不起 RPC、不写实例广告——它是一次性
// 短命进程。app 关着时它就是工程文件的唯一写者（安全）；app 开着时 CLI 走 RPC 不会 spawn 它（无并发写）。
import { app } from 'electron'

import { dispatch, RpcError } from './dispatcher'
import { runTask, fetchTaskResult } from '../runtime'
import { verifyToken } from './security'

// 身份对齐（解密 vendor key 的前提）：CLI 用 `electron host.js` spawn 时 getName 默认 "Electron"，与主 app
// 加密 safeStorage key 时的身份不符 → 解不开 key（真机实测「API key missing」根因）。spawner 经 NOMI_APP_NAME
// 传入主 app 身份（= package.json name），setName 对齐 keychain + 默认 userData 才能读到真 catalog 并解密。
// 必须在 app ready 前调。生产（host 在打包 app 内、getName 已是产品名）spawner 不传此 env → 不覆盖。
if (process.env.NOMI_APP_NAME) app.setName(process.env.NOMI_APP_NAME)

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
  // headless 永远是工程文件的唯一写者（app 关着时 CLI 才 spawn 它），无「项目正在打开」之说 → 全放行。
  try {
    const result = await dispatch(method, params, { runTask, fetchTaskResult })
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
    code = await run()
  } catch (error) {
    emit({ ok: false, error: error instanceof Error ? error.message : String(error) })
  } finally {
    app.exit(code)
  }
})
