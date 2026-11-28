// 常驻驱动的命令行（各线验证界面就用它；技能：.agents/skills/verify-nomi/SKILL.md）。
//
//   node tests/ux/ui.mjs up [--locale zh|en] [--theme light|dark] [--size 1440x900|1280x800|1100x720|1100x690|700x720] [--data empty|v0.24.0-library|v0.20.0-library] [--out <证据目录>] [--vendor fake-apimart] [--vendor-pending <n>] [--vendor-drop-submit <n>] [--vendor-fail-task <n>]
//                                            起一个隔离、安静的 Nomi，等到可驱动才返回（第一行打印「隔离 / 真实资料」）
//   node tests/ux/ui.mjs doctor               只读自检：是不是这次起的、构建新不新、隔离没有、语言 / 尺寸、现在在哪
//   node tests/ux/ui.mjs features             列出能 goto 的功能名
//   node tests/ux/ui.mjs goto <功能> [参数]     按功能地图走到那一屏，回「现在在哪 + 截图路径」
//   node tests/ux/ui.mjs snap                 列出当前可点元素（标签 / 文字 / aria / 中心坐标）
//   node tests/ux/ui.mjs shot [名字]           截图到证据目录 <名字>.<语言>.<配色>.png，再用 Read 看
//   node tests/ux/ui.mjs click "文字"           按可见文字点；也支持 aria:xx / css:sel / text:xx / role:button=名字 / xy:120,80
//   node tests/ux/ui.mjs fill <同 click 的定位> 值
//   node tests/ux/ui.mjs press Escape          按键（Playwright 键名）
//   node tests/ux/ui.mjs hover <同 click 的定位>
//   node tests/ux/ui.mjs drag x1 y1 x2 y2 [steps]
//   node tests/ux/ui.mjs read "document.title" 只读探针：在页面里求一个表达式的值（不许用它改状态）
//   node tests/ux/ui.mjs wait 800
//   node tests/ux/ui.mjs down                 关掉这次起的实例（同 quit / stop，证据留下）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { UI_DIR } from './uiDir.mjs'
import { UI_IPC_VERSION, writeUiIpcFile } from './uiIpcFile.mjs'
import { parseDriverArgs, pidAlive, profileBanner } from './uiDriverOptions.mjs'

const DIR = UI_DIR
const DRIVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-driver.mjs')
const ACTIONS = ['up', 'down', 'stop', 'restart', 'doctor', 'features', 'goto', 'snap', 'shot', 'click', 'fill', 'press', 'hover', 'setfile', 'read', 'drag', 'move', 'wait', 'quit', 'probe-latency', 'fps-start', 'fps-stop', 'density', 'contrast']
const [action, ...rest] = process.argv.slice(2)
if (!action || !ACTIONS.includes(action)) {
  console.error(`用法: node tests/ux/ui.mjs <${ACTIONS.join('|')}> ...（详见文件头）`)
  process.exit(1)
}

const readLockPid = () => {
  try { return Number(fs.readFileSync(path.join(DIR, 'instance.lock'), 'utf8').trim()) } catch { return null }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readReady() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, 'ready'), 'utf8')) ?? {}
  } catch (error) {
    if (error.code === 'ENOENT') return null
    if (error instanceof SyntaxError) return {}
    throw error
  }
}

function requireCurrentDriver(ready) {
  if (ready?.ipcVersion !== UI_IPC_VERSION) {
    console.error('驱动 IPC 版本不匹配。请先 node tests/ux/ui.mjs down，再 node tests/ux/ui.mjs up 重启驱动。')
    process.exit(2)
  }
}

async function up() {
  let options
  try {
    options = parseDriverArgs(rest)
  } catch (error) {
    console.error(error.message)
    process.exit(2)
  }
  const holder = readLockPid()
  if (holder && pidAlive(holder)) {
    const ready = readReady()
    if (ready !== null) requireCurrentDriver(ready)
    console.error(`这个工作树已经起了一个驱动实例（pid ${holder}）。先 node tests/ux/ui.mjs down，或直接接着用它（node tests/ux/ui.mjs doctor）`)
    process.exit(3)
  }
  if (!options.vendor) console.log(profileBanner(options))
  fs.mkdirSync(options.out, { recursive: true })
  const logPath = path.join(options.out, 'driver.log')
  const log = fs.openSync(logPath, 'a')
  const args = [DRIVER, ...rest.filter((arg, index) => !(arg === '--out' || rest[index - 1] === '--out' || arg.startsWith('--out='))), '--out', options.out]
  // 现有体感观察器按 cwd 落证据；假供应商的自动取证也留在 --out。
  const child = spawn(process.execPath, args, { cwd: options.vendor ? options.out : undefined, detached: true, stdio: ['ignore', log, log], env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' } })
  child.unref()
  let exited = null
  child.once('exit', (code) => { exited = code ?? 1 })
  const t0 = Date.now()
  while (readReady()?.driverPid !== child.pid) {
    if (exited !== null) {
      console.error(`驱动没起来（退出码 ${exited}）。日志尾：\n${fs.readFileSync(logPath, 'utf8').split('\n').slice(-25).join('\n')}`)
      process.exit(exited)
    }
    if (Date.now() - t0 > 150_000) {
      console.error(`150 秒没等到可驱动。日志：${logPath}`)
      process.exit(4)
    }
    await sleep(200)
  }
  const state = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json'), 'utf8'))
  if (state.fakeVendor) {
    console.log(`假供应商：${state.fakeVendor.name} @ ${new URL(state.fakeVendor.origin).host}`)
    console.log(profileBanner(options))
  }
  console.log(`READY in ${state.readySec}s · ${state.isolated ? 'isolated' : 'REAL PROFILE'} · ${state.locale} · ${state.theme} · ${state.size} · data=${state.data}`)
  console.log(`证据目录 ${state.out}（截图 / commands.jsonl / errors.log / driver.log）`)
  process.exit(0)
}

async function send(cmd, timeoutMs = 60_000) {
  const ready = readReady()
  if (ready === null) {
    console.error(`驱动没在跑（本工作树的 IPC 目录 ${DIR}）。先 node tests/ux/ui.mjs up`)
    process.exit(2)
  }
  if (cmd.action !== 'quit') requireCurrentDriver(ready)
  const resP = path.join(DIR, 'res.json')
  fs.rmSync(resP, { force: true })
  writeUiIpcFile(path.join(DIR, 'req.json'), JSON.stringify(cmd))
  const t0 = Date.now()
  while (!fs.existsSync(resP)) {
    if (Date.now() - t0 > timeoutMs) { console.error('超时：驱动没响应（node tests/ux/ui.mjs doctor 看看还在不在）'); process.exit(3) }
    await sleep(120)
  }
  // Legacy peers may still be writing the quit receipt. down waits for the lock holder to exit.
  if (cmd.action === 'quit') return
  const text = fs.readFileSync(resP, 'utf8')
  return { text, res: JSON.parse(text) }
}

async function down() {
  const holder = readLockPid()
  if (!fs.existsSync(path.join(DIR, 'ready')) && !(holder && pidAlive(holder))) {
    console.log('没有在跑的实例')
    process.exit(0)
  }
  let out = null
  try { out = JSON.parse(fs.readFileSync(path.join(DIR, 'state.json'), 'utf8')).out } catch { /* state gone */ }
  if (fs.existsSync(path.join(DIR, 'ready'))) await send({ action: 'quit' })
  const t0 = Date.now()
  while (holder && pidAlive(holder) && Date.now() - t0 < 30_000) await sleep(200)
  if (holder && pidAlive(holder)) {
    console.error(`驱动 pid ${holder} 30 秒没退，结束它（只结束这次起的那个进程）`)
    process.kill(holder, 'SIGTERM')
  }
  console.log(`已关闭。证据留在 ${out ?? '（证据目录见 up 的输出）'}`)
  process.exit(0)
}

if (action === 'up') await up()
else if (action === 'down' || action === 'quit' || action === 'stop') await down()
else {
  const cmd = { action }
  if (action === 'shot') cmd.name = rest[0]
  else if (action === 'goto') { cmd.name = rest[0]; cmd.args = rest.slice(1) }
  else if (action === 'click' || action === 'hover') cmd.target = rest.join(' ')
  else if (action === 'fill') { cmd.sel = rest[0]; cmd.val = rest.slice(1).join(' ') }
  else if (action === 'press') cmd.key = rest[0]
  else if (action === 'setfile') { cmd.sel = rest[0]; cmd.path = rest.slice(1).join(' ') }
  else if (action === 'read') cmd.js = rest.join(' ')
  else if (action === 'drag') { cmd.x1 = Number(rest[0]); cmd.y1 = Number(rest[1]); cmd.x2 = Number(rest[2]); cmd.y2 = Number(rest[3]); cmd.steps = Number(rest[4] || 12) }
  else if (action === 'move') { cmd.x = Number(rest[0]); cmd.y = Number(rest[1]) }
  else if (action === 'wait') cmd.ms = Number(rest[0] || 500)
  else if (action === 'probe-latency') { cmd.target = rest[0]; cmd.name = rest[1]; cmd.wait = Number(rest[2] || 1800) }
  else if (action === 'contrast') cmd.sel = rest.join(' ')
  const { text, res } = await send(cmd, action === 'goto' || action === 'restart' ? 180_000 : 60_000)
  if (action === 'doctor' && res.doctor?.fakeVendor) console.log(`假供应商：${res.doctor.fakeVendor.name} @ ${new URL(res.doctor.fakeVendor.origin).host}`)
  console.log(action === 'doctor' || action === 'features' ? JSON.stringify(res, null, 2) : text)
  if (res.error || (action === 'doctor' && res.doctor && !res.doctor.ok)) process.exit(1)
}
