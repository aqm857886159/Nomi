// 打包产物的**出厂配置门岗**（2026-09-17，W-01）。
//
// 它拦的那件事已经发生过一次：0.21.0 出厂时 `endpointConfigured:false`，用户点了「愿意」、
// 写了反馈、拿到编号，东西却只躺在本机发件箱里。链路全绿（两条走查自己在 env 里塞端点），
// 单测全绿（测的是解析规则），打包全绿（没人验过包里有没有这份配置）——
// **谁也没有验「出厂的那个包配没配」**，所以它静默出厂了。
//
// 判据只有一条：打进 app.asar 的 `dist-electron/intake-config.json` 里 endpoint 与 token 都非空。
// 它必须跑在**产物**上、不能跑在源码或 env 上——env 在打包机上是对的，那正是上次骗过所有人的地方。
//
// 用法：
//   node scripts/check-packaged-intake.mjs release/mac-arm64/Nomi.app
//   node scripts/check-packaged-intake.mjs release/win-unpacked
//
// 为什么不进 `pnpm run gates`：本机开发构建**本来就该是空的**（开发版不发送）。
// 这道门只在「要发给用户的包」那一步有意义，所以它挂在 CI 的打包 job 上，紧跟 electron-builder。
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { extractFile } from '@electron/asar'

const ASAR_RELATIVE = 'dist-electron/intake-config.json'

/** 从打包产物里找到 app.asar：mac 是 Contents/Resources，win/linux 是 resources。 */
export function resolveAsar(target) {
  const candidates = [
    path.join(target, 'Contents', 'Resources', 'app.asar'),
    path.join(target, 'resources', 'app.asar'),
    target.endsWith('.asar') ? target : '',
  ].filter(Boolean)
  const found = candidates.find((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile())
  if (!found) throw new Error(`找不到 app.asar：${target}\n找过：\n${candidates.join('\n')}`)
  return found
}

export function readPackagedIntakeConfig(target) {
  const asar = resolveAsar(target)
  // 用 @electron/asar 的官方 API 而不是自己解格式：格式是 electron-builder 的，
  // 自己解一份就是第二个真相源，上游改版时它会安静地读错。
  return JSON.parse(extractFile(asar, ASAR_RELATIVE).toString('utf8'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2]
  if (!target) {
    console.error('用法: node scripts/check-packaged-intake.mjs <打包产物目录或 .app>')
    process.exit(2)
  }
  let config
  try {
    config = readPackagedIntakeConfig(target)
  } catch (error) {
    console.error(`出厂配置门岗：读不出 ${ASAR_RELATIVE} —— ${error?.message || error}`)
    process.exit(1)
  }
  const missing = ['endpoint', 'token'].filter((field) => !String(config?.[field] || '').trim())
  if (missing.length) {
    console.error(
      `出厂配置门岗：包里的 ${ASAR_RELATIVE} 缺 ${missing.join(' / ')}。\n` +
      '→ 打包步骤必须带上 NOMI_INTAKE_ENDPOINT / NOMI_INTAKE_TOKEN（GitHub Actions secret）。\n' +
      '  缺了它，用户点「愿意」之后反馈也发不出去，而界面上看不出来。',
    )
    process.exit(1)
  }
  // 端点打印出来（它不是秘密，看得见才验得了打的是不是对的那个）；令牌永不打印。
  console.log(`出厂配置门岗 ✓ endpoint=${config.endpoint} token=<${String(config.token).length} chars>`)
}
