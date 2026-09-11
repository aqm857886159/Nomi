// 发版证据 · **打包后的 Nomi 里，bash 的系统级沙箱真的起得来**。
//
// 为什么这件事必须在打包产物上验、而不是靠单测：沙箱是否 active 取决于两件只有打包后才成立的事
//   ① `@anthropic-ai/sandbox-runtime` 能不能从 `app.asar` 这个只读归档里被解析并加载；
//   ② 它的 `vendor/` 资产是不是真文件（asar 里的路径不能 exec，也不能交给 JVM 打开）。
// 开发树上两件事恒成立，所以 `pnpm run test` 全绿也证不了打包后的那台机器。
//
// 不 active 的后果不是报错，是**每一条命令都要用户逐条点头**（`codingCommandPolicy` 的
// 自动放行整档消失）。也就是说这条回归**没有崩溃、没有红灯**，只有「Nomi 今天怎么这么啰嗦」。
// 所以它需要一条自己的证据线。
//
// 为什么不用 Playwright 的 `app.evaluate`：那里 `require` 与动态 `import()` 都不可用
// （`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`，见 docs/lessons/walkthrough-default-profile-is-isolated.md）。
// 这里走的是仓库里已有的另一条既定路子（`packaged-mcp-smoke.e2e.mjs`）：用打包好的 Electron
// helper 以 `ELECTRON_RUN_AS_NODE=1` 起一个 node，**模块解析锚在打包产物自己的生产模块上**，
// 于是解析链、asar 读写、vendor 落点全都是真实那一套。
//
// 用法：node tests/ux/packaged-sandbox-active.e2e.mjs release/mac-arm64/Nomi.app
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const bundlePath = path.resolve(process.argv[2] || '')
if (!bundlePath || !fs.existsSync(bundlePath)) {
  throw new Error(`PACKAGED SANDBOX EVIDENCE FAIL: 找不到打包产物：${bundlePath || '(未传参)'}`)
}

const darwin = process.platform === 'darwin'
const resourcesPath = darwin
  ? path.join(bundlePath, 'Contents', 'Resources')
  : path.join(path.dirname(bundlePath), 'resources')
// helper 进程（而不是主二进制）是 `ELECTRON_RUN_AS_NODE` 的既定载体，与 MCP 冒烟同源。
const launcherPath = darwin
  ? path.join(bundlePath, 'Contents', 'Frameworks', 'Nomi Helper.app', 'Contents', 'MacOS', 'Nomi Helper')
  : bundlePath
const appAsar = path.join(resourcesPath, 'app.asar')
// 生产里 import 这个包的就是它；把解析锚在这个文件上，拿到的解析链和运行时一模一样。
const productionModule = path.join(appAsar, 'dist-electron', 'agentLane', 'laneNativeDesktop.mjs')
const sandboxModule = path.join(appAsar, 'dist-electron', 'agentLane', 'laneCodingSandbox.mjs')

for (const required of [launcherPath, appAsar]) {
  if (!fs.existsSync(required)) {
    throw new Error(`PACKAGED SANDBOX EVIDENCE FAIL: 打包产物缺件：${required}`)
  }
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-packaged-sandbox-'))
const projectDir = path.join(tempRoot, 'project')
const settingsRoot = path.join(tempRoot, 'settings')
fs.mkdirSync(projectDir, { recursive: true })
fs.mkdirSync(settingsRoot, { recursive: true })

// 探针**住在临时目录**，不写进 .app：往签好名的包里塞文件会当场毁掉签名，
// 而「为了验证而改掉被验证物」正是这条证据最不能出的事。
const probePath = path.join(tempRoot, 'probe.mjs')
fs.writeFileSync(probePath, `
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const out = (payload) => process.stdout.write(JSON.stringify(payload) + '\\n')
try {
  const require = createRequire(${JSON.stringify(productionModule)})
  const runtimeEntry = require.resolve('@anthropic-ai/sandbox-runtime')
  const { SandboxManager } = await import(pathToFileURL(runtimeEntry).href)
  const { openLaneSandbox, sandboxPolicyFor, laneSandboxVendorPaths } =
    await import(pathToFileURL(${JSON.stringify(sandboxModule)}).href)
  const policy = sandboxPolicyFor({ projectDir: ${JSON.stringify(projectDir)}, settingsRoot: ${JSON.stringify(settingsRoot)} })
  const localOperations = { exec: async () => ({ exitCode: 0 }) }
  const sandbox = await openLaneSandbox(policy, { manager: SandboxManager, localOperations })
  let commandOutput = ''
  let commandExit = null
  if (sandbox.active) {
    // active 只说明 initialize 没抛。真正要证的是**包进去的东西能跑**：
    // 让一条命令穿过 seatbelt 包装真的执行一次，输出对上才算数。
    const result = await sandbox.operations.exec('echo nomi-sandbox-ok', ${JSON.stringify(projectDir)}, {
      onData: (chunk) => { commandOutput += String(chunk) },
      timeout: 60000,
    })
    commandExit = result.exitCode
  }
  await sandbox.close()
  // 「解包了没有」只有在**同时看得见归档内外**的进程里才问得出来。Electron 的 fs 层
  // 会把 app.asar 里的路径读进来（不管那条目解没解包），而 app.asar.unpacked 是真盘上的路径。
  // 于是判据是一条蕴含：归档里有 ⇒ 解包处也必须有真文件。只有归档里有、解包处没有的那个，
  // 才是「读得到但 exec 不了」的那一族。平台裁掉的资产（mac 包里的 .exe）两边都没有，不算违规。
  const runtimeRoot = path.dirname(path.dirname(runtimeEntry))
  const unpackedRoot = runtimeRoot.replace(\`\${path.sep}app.asar\${path.sep}\`, \`\${path.sep}app.asar.unpacked\${path.sep}\`)
  const vendorAssets = []
  const walkVendor = (relative) => {
    const inArchive = path.join(runtimeRoot, relative)
    for (const entry of fs.readdirSync(inArchive, { withFileTypes: true })) {
      const next = relative ? relative + '/' + entry.name : entry.name
      if (entry.isDirectory()) { walkVendor(next); continue }
      if (/\\.ts$/.test(entry.name)) continue
      vendorAssets.push({ asset: next,
        unpacked: fs.statSync(path.join(unpackedRoot, next), { throwIfNoEntry: false })?.isFile() === true })
    }
  }
  walkVendor('vendor')
  // 最后一问，也是最要命的一问：**我们真的把解包处那条路径交出去了吗**。
  // 上面两条各证了一半——active:true 证 seatbelt 起得来，vendorAssets 证盘上有真文件。
  // 两条都绿，二进制仍可能一次都用不上：运行时自己找 vendor 用的是 import.meta.url，
  // 打包后那指进 app.asar，而它那句 existsSync 在 Electron 里回 true，于是它「找到了」、
  // 不再试别的候选，然后把一个 execve 不了的路径交出去。这一段跑的是生产那个函数，
  // 断言它给出的每条路径都落在 app.asar.unpacked 下、且是一个**真文件**。
  const vendorPaths = laneSandboxVendorPaths({
    resolvePackageJson: () => createRequire(${JSON.stringify(productionModule)})
      .resolve('@anthropic-ai/sandbox-runtime/package.json'),
    exists: (candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() === true,
    platform: process.platform,
    arch: process.arch,
  })
  const handedOut = []
  const collect = (label, value) => { if (typeof value === 'string') handedOut.push({ label, value }) }
  collect('javaAgentJarPath', vendorPaths.javaAgentJarPath)
  collect('seccomp.applyPath', vendorPaths.seccomp?.applyPath)
  collect('windows.srtWin.path', vendorPaths.windows?.srtWin?.path)
  out({ runtimeEntry, active: sandbox.active, inactive: sandbox.inactive ?? null,
    commandExit, commandOutput: commandOutput.trim(), vendorAssets, handedOut })
} catch (error) {
  out({ active: false, thrown: error && error.stack ? error.stack : String(error) })
}
`, 'utf8')

const child = spawn(launcherPath, [probePath], {
  cwd: tempRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
})

let stdout = ''
child.stdout.on('data', (chunk) => { stdout += String(chunk) })

const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject)
  child.on('close', resolve)
})

const line = stdout.trim().split('\n').filter(Boolean).at(-1)
if (exitCode !== 0 || !line) {
  throw new Error(`PACKAGED SANDBOX EVIDENCE FAIL: 探针退出码 ${exitCode}，输出：${stdout.trim() || '(空)'}`)
}
const report = JSON.parse(line)
console.log(`packaged sandbox runtime entry: ${report.runtimeEntry ?? '(未解析到)'}`)
console.log(`packaged sandbox active:${report.active} exit:${report.commandExit} output:${JSON.stringify(report.commandOutput ?? '')}`)

if (!report.active) {
  throw new Error(`PACKAGED SANDBOX EVIDENCE FAIL: active:false —— ${JSON.stringify(report.inactive ?? report.thrown)}`)
}
// active:true 只证了 macOS 这条路（seatbelt 只要 `/usr/bin/sandbox-exec`，从不碰 `vendor/`）。
// **解包本身要另证**：`require.resolve` 返回的永远是 `app.asar/...` 这个名字——归档里
// 解没解包的条目长得一模一样，读的时候由 Electron 的 fs 层悄悄改道到 `app.asar.unpacked`。
// 真正能 exec、能交给 JVM 打开的，只有 `app.asar.unpacked` 下那个真文件。
const trapped = (report.vendorAssets ?? []).filter((entry) => !entry.unpacked)
console.log(`packaged sandbox vendor assets: ${(report.vendorAssets ?? []).length} in archive, ${trapped.length} trapped inside app.asar`)
if (trapped.length > 0) {
  throw new Error('PACKAGED SANDBOX EVIDENCE FAIL: 这些资产卡在 app.asar 里（读得到，但 exec 不了）：\n'
    + trapped.map((entry) => entry.asset).join('\n'))
}
// 第三条证据：生产代码交给运行时的那几条路径。空集合本身就是失败——
// jar 没有平台条件，三个平台都该有一条，一条都没有 = 解析链断了。
const handedOut = report.handedOut ?? []
console.log(`packaged sandbox vendor paths handed to runtime: ${handedOut.length}`)
for (const entry of handedOut) {
  console.log(`  ${entry.label} -> ${entry.value}`)
}
if (handedOut.length === 0) {
  throw new Error('PACKAGED SANDBOX EVIDENCE FAIL: 一条 vendor 路径都没交出去——包解析不到，二进制等于没带')
}
for (const entry of handedOut) {
  if (!entry.value.includes('app.asar.unpacked')) {
    throw new Error(`PACKAGED SANDBOX EVIDENCE FAIL: ${entry.label} 仍指进归档：${entry.value}`)
  }
  // 判据用的是**归档外的普通 fs**（本进程没有 Electron 的 asar 补丁），
  // 看到的就是 execve / JVM 看到的那一份。
  if (!fs.statSync(entry.value, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`PACKAGED SANDBOX EVIDENCE FAIL: ${entry.label} 不是盘上的真文件：${entry.value}`)
  }
}
if (report.commandExit !== 0 || report.commandOutput !== 'nomi-sandbox-ok') {
  throw new Error(`PACKAGED SANDBOX EVIDENCE FAIL: 沙箱里的命令没跑通：exit=${report.commandExit} output=${JSON.stringify(report.commandOutput)}`)
}

fs.rmSync(tempRoot, { recursive: true, force: true })
console.log('PACKAGED SANDBOX EVIDENCE PASS')
