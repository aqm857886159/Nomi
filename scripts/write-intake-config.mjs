// 把反馈回路的**出厂配置**烤进构建产物（2026-09-17，W-01）。
//
// 为什么需要这一步：`electron/telemetry/intakeClient.ts` 只从 `process.env` 取端点与令牌，
// 而**装机版的 process.env 是用户桌面的环境**——里面永远没有这两个值。于是 0.21.0 出厂时
// `endpointConfigured:false`：用户点了「愿意」、写了反馈、拿到了编号 NF-0917-0001，
// 东西却只躺在本机发件箱里，谁也没收到。走查里那两条 walk 自己在 env 里塞过值，
// 所以链路一直是绿的——绿的是链路，缺的是出厂配置。
//
// 怎么烤：CI 打包前把 secret 放进构建进程的 env，这个脚本在 tsc 之后把它们写成
// `dist-electron/intake-config.json`。`dist-electron/**` 在 electron-builder 的 files 里，
// 于是它随 app.asar 一起出厂。
//
// 令牌写进包里是**刻意**的，不是泄漏：它是发布令牌，解包就能拿到，接收端只能写不能读/列/删
// （`infra/feedback-worker/README.md` 的「三条要诚实说清的事」）。任何地方都不要把它说成「已鉴权」。
//
// 本机开发构建不设这两个 env → 写出一份空配置 → `endpointConfigured:false`，
// 设置页照旧显示「只在本机记录」。这是**期望行为**：开发版不该往线上接收端发东西。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const INTAKE_CONFIG_RELATIVE = 'dist-electron/intake-config.json'

/** 写出配置，返回写进去的内容（endpoint 供调用方打印，token 永不打印）。 */
export function writeIntakeConfig(repoRoot, env = process.env) {
  const endpoint = String(env.NOMI_INTAKE_ENDPOINT || '').trim().replace(/\/+$/, '')
  const token = String(env.NOMI_INTAKE_TOKEN || '').trim()
  const file = path.join(repoRoot, INTAKE_CONFIG_RELATIVE)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // `version` 不是装饰：将来换字段时，读侧要能分清「旧包」与「配置坏了」。
  fs.writeFileSync(file, JSON.stringify({ version: 1, endpoint, token }) + '\n')
  return { endpoint, configured: endpoint.length > 0 && token.length > 0 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = writeIntakeConfig(repoRoot)
  console.log(result.configured
    ? `intake config baked: ${result.endpoint}`
    : 'intake config baked: (empty — 本机/开发构建，出厂后只在本机记录)')
}
