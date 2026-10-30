#!/usr/bin/env node
// Windows 安装器真装真升真卸：设计卡 ★9 的场景 A1–A13 与反例 CX1–CX3
// （docs/plan/2026-10-29-installer-keep-user-files.md）。只在 Windows 上跑，由 .github/workflows/win-installer.yml 调用；
// 场景登记在 tests/installer/scenarios.mjs，普查在 tests/installer/installerScenarios.test.mjs。
//
// 用法（工作流里就是这一行，不带 --only）：
//   node tests/installer/windows-installer-scenarios.mjs --old <v0.24.0 安装包> --old-sums <SHA256SUMS.txt>
//     --new <本次构建的安装包> --manifest .tmp/installer-manifest/Nomi-x64.json --unpacked release/win-unpacked
//     --work <工作目录，路径里不能有空格> --report <报告.json> [--counterexamples]
//   --only <场景 id>：只给本机排查用。
//
// 约定：
//   · 每个场景前后都把机器清干净：结束工作目录里起的进程，删 Nomi 的注册表项、待恢复记录、快捷方式、默认安装目录和场景目录；
//   · 安装程序按 NSIS 的规矩原样传参（windowsVerbatimArguments）：/D= 和 _?= 必须放最后、不能加引号，所以安装包路径不能有空格；
//   · 对话框由 tests/installer/dialog-watcher.ps1 记下并关掉；静默安装里出现的每个对话框都要被场景认领，否则算红；
//   · 卸载照 electron-builder 升级时的做法：把卸载程序拷出安装目录再带 _?= 跑（同步等它结束）；
//   · 用户数据放三处（A1、A11）：默认位置（「文档」\Nomi Projects 下一个本场景专用的项目文件夹，跑完删掉，只删这个文件夹）、
//     安装目录外的自选位置（和安装目录同级）、安装目录里；升级后、卸载后各验一遍。
// Node 全局都显式 import：tests/installer/ 不在 eslint 配置的 Node 脚本目录里（本目录只有这一个 Node 脚本）。
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import console from 'node:console'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { encodedPowerShell, powershell, powerShellFailure, spawnPowerShell } from './powershell.mjs'
import { COUNTEREXAMPLES, DEFAULT_PROJECTS_FOLDER, KEEP_README, KEEP_SUFFIX, MARKER_VALUE_NAME, PENDING_VALUE_PREFIX, SCENARIOS } from './scenarios.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const WATCHER = path.join(repoRoot, 'tests', 'installer', 'dialog-watcher.ps1')
/** 旧版：GitHub Release v0.24.0（事故发生的那一版，卸载程序还是 RMDir /r）。 */
export const OLD_VERSION = '0.24.0'
const INSTALLER_TIMEOUT_MS = 20 * 60_000
/** 我们自己起的安装 / 卸载进程名；只有它们的对话框算数（runner 桌面上别的系统弹窗只记录、不判）。 */
const INSTALLER_PROCESS = /^(?:nomi-|old-uninstaller$|Au_$|Un_A$|Uninstall )/i

/** 事故原样：项目文件夹（含 .nomi\project.json 和素材）+ 顶层散文件。 */
const INCIDENT_FILES = [
  { rel: 'xiangmu\\proj1\\.nomi\\project.json', text: '{"name":"proj1","shots":12}' },
  { rel: 'xiangmu\\proj1\\assets\\shot.png', bytes: 96 * 1024 },
  { rel: 'xiangmu\\proj2\\.nomi\\project.json', text: '{"name":"proj2"}' },
  { rel: 'notes.txt', text: '用户随手放在安装目录里的笔记' },
]
const NESTED_FILES = [
  { rel: 'resources\\user-notes\\a.txt', text: 'kept during the very first upgrade' },
  { rel: 'locales\\my.txt', text: 'kept inside another installer folder' },
]
const INCIDENT_TOP_LEVEL = ['xiangmu', 'notes.txt']

/** 安装目录外的两处（默认位置、自选位置）各放一个项目：事故里放在「文档」里、幸存下来的第 6 个项目就是这种。 */
const OUTSIDE_PROJECT_FILES = [
  { rel: '.nomi\\project.json', text: '{"name":"outside the install folder"}' },
  { rel: 'assets\\shot.png', bytes: 32 * 1024 },
]

/** 本来就装满用户文件的目录：多层、中文、特殊字符、隐藏、只读、空目录、0 字节、带 $ 的名字。 */
const FULL_DIR_FILES = [
  { rel: '合同\\2026 合同.docx', bytes: 20 * 1024 },
  { rel: '照片\\旅行\\IMG_0001.jpg', bytes: 64 * 1024 },
  { rel: '照片\\旅行\\.note', text: 'hidden note', hidden: true },
  { rel: '只读说明.txt', text: '只读文件', readonly: true },
  { rel: '隐藏文件.txt', text: 'hidden at top level', hidden: true },
  { rel: '空文件夹', emptyDir: true },
  { rel: '零字节.bin', bytes: 0 },
  { rel: "it's & #1 (copy) [x] 100%.txt", text: 'special characters' },
  { rel: 'price $5 $nomiL.txt', text: 'dollar signs must stay literal' },
  { rel: 'xiangmu\\proj1\\.nomi\\project.json', text: '{"name":"proj1"}' },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex')
const sha256File = (file) => sha256(fs.readFileSync(file))
const psq = (value) => `'${String(value).replaceAll("'", "''")}'`
const fromRel = (dir, rel) => path.join(dir, ...rel.split('\\'))
const isDir = (target) => fs.existsSync(target) && fs.statSync(target).isDirectory()
const samePath = (a, b) => String(a || '').replace(/\\+$/, '').toLowerCase() === String(b || '').replace(/\\+$/, '').toLowerCase()

/** 反例用：find 必须在 installer.nsh 里恰好出现一次，替换后必须真的变了（普查测试在 Mac 上就核这一点）。 */
export function applyMutation(source, counterexample) {
  const count = source.split(counterexample.find).length - 1
  if (count !== 1) throw new Error(`counterexample ${counterexample.id}: expected exactly one "${counterexample.find}" in build/installer.nsh, found ${count}`)
  const mutated = source.replace(counterexample.find, () => counterexample.replace)
  if (mutated === source) throw new Error(`counterexample ${counterexample.id}: replacement did not change build/installer.nsh`)
  return mutated
}

function killTree(pid) {
  if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
}

function exitOf(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, timedOut: false })
      return
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, timedOut, error: String(error) })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, timedOut })
    })
  })
}

function registryEntries() {
  const json = powershell(`
$out = @()
foreach ($hive in @('HKCU:', 'HKLM:')) {
  $uninstallRoot = $hive + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  if (-not (Test-Path -LiteralPath $uninstallRoot)) { continue }
  foreach ($key in @(Get-ChildItem -LiteralPath $uninstallRoot)) {
    $p = Get-ItemProperty -Path $key.PSPath
    if ($p.DisplayName -like 'Nomi*') {
      $guid = $key.PSChildName
      $installKey = $hive + '\\Software\\' + $guid
      $install = if (Test-Path -LiteralPath $installKey) { Get-ItemProperty -LiteralPath $installKey } else { $null }
      $out += [pscustomobject]@{ hive = $hive.TrimEnd(':'); guid = $guid; displayName = [string]$p.DisplayName; displayVersion = [string]$p.DisplayVersion; installLocation = [string]$install.InstallLocation; marker = [string]$install.${MARKER_VALUE_NAME} }
    }
  }
}
ConvertTo-Json -InputObject @($out) -Compress
`)
  return JSON.parse(json || '[]')
}

function pendingRecordExists() {
  return powershell(`
$found = @(Get-ChildItem -Path 'HKCU:\\Software' | Where-Object { $_.PSChildName -like ('*' + ${psq(KEEP_SUFFIX)}) })
if ($found.Count -gt 0) { 'yes' } else { 'no' }
`) === 'yes'
}

function setRegistryValue(hive, subkey, name, value) {
  powershell(`
$key = ${psq(`${hive}:\\${subkey}`)}
if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key | Out-Null }
New-ItemProperty -LiteralPath $key -Name ${psq(name)} -Value ${psq(value)} -PropertyType String -Force | Out-Null
`)
}

function processesUnder(dir) {
  const json = powershell(`
$dir = ${psq(dir)}
$found = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; path = $_.ExecutablePath } })
ConvertTo-Json -InputObject $found -Compress
`)
  return JSON.parse(json || '[]')
}

function attributesOf(files) {
  const json = powershell(`
$files = ${psq(JSON.stringify(files))} | ConvertFrom-Json
$out = @($files | ForEach-Object { (Get-Item -LiteralPath $_ -Force).Attributes.ToString() })
ConvertTo-Json -InputObject $out -Compress
`)
  return JSON.parse(json || '[]')
}

function isElevated() {
  return powershell('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)') === 'True'
}

function shortcutPaths(productFilename) {
  const json = powershell(`
$name = ${psq(`${productFilename}.lnk`)}
$out = @('Desktop', 'Programs', 'CommonDesktopDirectory', 'CommonPrograms') | ForEach-Object { Join-Path ([Environment]::GetFolderPath($_)) $name }
ConvertTo-Json -InputObject @($out) -Compress
`)
  return JSON.parse(json || '[]')
}

/** 把机器恢复到「从没装过 Nomi」：只动 Nomi 的注册表项、待恢复记录、快捷方式、默认安装目录、本次工作目录，和本次种在「文档」里的测试项目文件夹。 */
const IFEO_KEYS = [
  'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\old-uninstaller.exe',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\old-uninstaller.exe',
]
function clearIfeo() {
  powershell(`foreach ($key in @(${IFEO_KEYS.map(psq).join(', ')})) { if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force } }`)
}

async function waitForFile(file, check, label) {
  const deadline = performance.now() + 120_000
  while (!fs.existsSync(file)) {
    check?.()
    if (performance.now() >= deadline) throw new Error(`setup: timed out waiting for ${label}: ${file}`)
    await sleep(100)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function resetMachine(state) {
  clearIfeo()
  for (const dir of state.outsideSeeds.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  powershell(`
$roots = @(${psq(state.work)}, (Join-Path $env:LOCALAPPDATA 'Programs\\${state.manifest.productFilename}'))
Get-CimInstance Win32_Process | Where-Object { $p = $_.ExecutablePath; $p -and @($roots | Where-Object { $p.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
foreach ($hive in @('HKCU:', 'HKLM:')) {
  $uninstallRoot = $hive + '\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
  $keys = if (Test-Path -LiteralPath $uninstallRoot) { @(Get-ChildItem -LiteralPath $uninstallRoot) } else { @() }
  foreach ($key in $keys) {
    $p = Get-ItemProperty -Path $key.PSPath
    if ($p.DisplayName -like 'Nomi*') {
      $installKey = $hive + '\\Software\\' + $key.PSChildName
      if (Test-Path -LiteralPath $installKey) { Remove-Item -LiteralPath $installKey -Recurse -Force }
      Remove-Item -Path $key.PSPath -Recurse -Force
    }
  }
  foreach ($key in @(Get-ChildItem -Path ($hive + '\\Software') | Where-Object { $_.PSChildName -like ('*' + ${psq(KEEP_SUFFIX)}) })) { Remove-Item -Path $key.PSPath -Recurse -Force }
}
${state.guid ? `foreach ($hive in @('HKCU:', 'HKLM:')) { $key = $hive + '\\Software\\' + ${psq(state.guid)}
if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force } }` : ''}

`)
  for (const shortcut of shortcutPaths(state.manifest.productFilename)) fs.rmSync(shortcut, { recursive: true, force: true })
  fs.rmSync(path.join(process.env.LOCALAPPDATA, 'Programs', state.manifest.productFilename), { recursive: true, force: true })
  fs.rmSync(path.join(state.work, 's'), { recursive: true, force: true })
}

/** 跑一次安装 / 卸载程序，同时记录它弹出的对话框。 */
async function runInstaller(state, exe, args, label, onSpawn) {
  if (/\s/.test(exe)) throw new Error(`installer path must not contain spaces (the NSIS command line is passed verbatim): ${exe}`)
  state.runCounter += 1
  const tag = `${String(state.runCounter).padStart(3, '0')}`
  const dialogDir = path.join(state.work, 'dialogs')
  fs.mkdirSync(dialogDir, { recursive: true })
  const outFile = path.join(dialogDir, `${tag}.jsonl`)
  const readyFile = path.join(dialogDir, `${tag}.ready`)
  const stopFile = path.join(dialogDir, `${tag}.stop`)
  const watcherProcess = spawnPowerShell(['-File', WATCHER, '-OutFile', outFile, '-ReadyFile', readyFile, '-StopFile', stopFile])
  const watcher = watcherProcess.child
  const watcherExit = exitOf(watcher, INSTALLER_TIMEOUT_MS + 5 * 60_000)
  for (let i = 0; i < 600 && !fs.existsSync(readyFile) && !watcherProcess.result.closed; i += 1) await sleep(100)
  if (!fs.existsSync(readyFile)) {
    killTree(watcher.pid)
    await watcherProcess.done
    throw new Error(`setup: dialog watcher did not start: ${powerShellFailure(watcherProcess.result, 'dialog watcher')}`)
  }
  const started = performance.now()
  const child = spawn(exe, args, { windowsVerbatimArguments: true, stdio: 'ignore', cwd: state.work })
  const pendingExit = exitOf(child, INSTALLER_TIMEOUT_MS)
  if (onSpawn) onSpawn(child)
  const result = await pendingExit
  const durationMs = Math.round(performance.now() - started)
  await sleep(1500)
  fs.writeFileSync(stopFile, 'stop')
  const stopped = await Promise.race([watcherExit, sleep(30_000).then(() => null)])
  if (!stopped) killTree(watcher.pid)
  const watcherResult = await watcherProcess.done
  if (!stopped || stopped.timedOut || watcherResult.status !== 0 || watcherResult.error) {
    throw new Error(`harness: ${!stopped || stopped.timedOut ? 'dialog watcher timed out; ' : ''}${powerShellFailure(watcherResult, 'dialog watcher')}`)
  }
  const dialogs = fs.existsSync(outFile)
    ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  const run = {
    label,
    args: args.join(' '),
    exitCode: result.code,
    timedOut: result.timedOut,
    spawnError: result.error,
    durationMs,
    dialogs: dialogs.filter((dialog) => INSTALLER_PROCESS.test(dialog.process)),
    otherDialogs: dialogs.filter((dialog) => !INSTALLER_PROCESS.test(dialog.process)),
  }
  state.current.runs.push(run)
  console.log(`    ${label}: exit ${run.exitCode}${run.timedOut ? ' (timed out)' : ''}, ${run.dialogs.length} dialog(s), ${durationMs}ms`)
  return run
}

/** 一个场景里能用的动作和断言；断言失败一律抛错，消息写清是哪一项（反例按消息认红在哪）。 */
function scenarioContext(state, root, newExe) {
  const manifest = state.manifest
  const appExe = `${manifest.productFilename}.exe`
  const t = {
    root,
    manifest,
    newVersion: manifest.version,
    get guid() {
      if (!state.guid) throw new Error('setup: the Nomi registry GUID is not known yet')
      return state.guid
    },
    learnRegistration(hive, dir, version) {
      const entry = registryEntries().find((item) => item.hive === hive)
      if (!entry || entry.displayVersion !== version || !samePath(entry.installLocation, dir)) {
        throw new Error(`setup: expected ${hive} registration of ${version} at ${dir}, got ${JSON.stringify(registryEntries())}`)
      }
      state.guid = entry.guid
      return entry
    },
    async installOld(dir, { allUsers = false } = {}) {
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      const run = await runInstaller(state, state.oldExe, ['/S', ...(allUsers ? ['/allusers'] : []), `/D=${dir}`], `install ${OLD_VERSION}${allUsers ? ' for all users' : ''}`)
      t.expectExit(run, 0)
      t.expectNoDialogs(run)
      return t.learnRegistration(allUsers ? 'HKLM' : 'HKCU', dir, OLD_VERSION)
    },
    async installNew(dir) {
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      const run = await runInstaller(state, newExe, ['/S', `/D=${dir}`], 'install the build under test')
      t.expectExit(run, 0)
      t.expectNoDialogs(run)
      t.learnRegistration('HKCU', dir, manifest.version)
      t.expectAppInstalled(dir)
      return run
    },
    upgrade(label = 'upgrade --updated /S') {
      return runInstaller(state, newExe, ['--updated', '/S'], label)
    },
    reinstallTo(dir, label = 'reinstall into another folder') {
      fs.mkdirSync(path.dirname(dir), { recursive: true })
      return runInstaller(state, newExe, ['/S', `/D=${dir}`], label)
    },
    uninstall(dir, { allUsers = false, label = 'uninstall' } = {}) {
      state.uninstallCounter += 1
      const copy = path.join(state.work, 'bin', `nomi-uninstall-${state.uninstallCounter}.exe`)
      fs.copyFileSync(path.join(dir, manifest.uninstallerFileName), copy)
      return runInstaller(state, copy, ['/S', allUsers ? '/allusers' : '/currentuser', `_?=${dir}`], label)
    },
    seed(dir, spec) {
      const seeded = []
      for (const entry of spec) {
        const target = fromRel(dir, entry.rel)
        if (entry.emptyDir) {
          fs.mkdirSync(target, { recursive: true })
          seeded.push({ rel: entry.rel, emptyDir: true })
          continue
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        const data = entry.text !== undefined ? Buffer.from(entry.text, 'utf8') : crypto.randomBytes(entry.bytes ?? 0)
        fs.writeFileSync(target, data)
        seeded.push({ rel: entry.rel, sha256: sha256(data), hidden: Boolean(entry.hidden), readonly: Boolean(entry.readonly) })
      }
      for (const item of seeded.filter((s) => s.hidden || s.readonly)) {
        const flags = [item.hidden ? '+H' : null, item.readonly ? '+R' : null].filter(Boolean)
        const result = spawnSync('attrib', [...flags, fromRel(dir, item.rel)], { stdio: 'ignore' })
        if (result.status !== 0) throw new Error(`setup: attrib failed for ${item.rel}`)
      }
      return seeded
    },
    /**
     * 用户数据放三处：默认位置（「文档」\Nomi Projects 下本场景专用的项目文件夹）、安装目录外的自选位置（和安装目录同级）、
     * 安装目录里（insideSpec）。返回每处种了什么，给 expectPlaces 核。
     */
    seedPlaces(installDir, insideSpec) {
      const defaultDir = path.join(state.documents, DEFAULT_PROJECTS_FOLDER, `installer-test-${path.basename(root)}`)
      state.outsideSeeds.push(defaultDir)
      fs.rmSync(defaultDir, { recursive: true, force: true })
      const customDir = path.join(root, '自选项目', 'proj6')
      return [
        { name: 'default location', dir: defaultDir, seeded: t.seed(defaultDir, OUTSIDE_PROJECT_FILES) },
        { name: 'custom location outside the install folder', dir: customDir, seeded: t.seed(customDir, OUTSIDE_PROJECT_FILES) },
        { name: 'inside the install folder', dir: installDir, seeded: t.seed(installDir, insideSpec) },
      ]
    },
    expectPlaces(places, when) {
      for (const place of places) t.expectUserFiles(place.dir, place.seeded, `${when}, ${place.name}`)
    },
    expectExit(run, code) {
      if (run.timedOut) throw new Error(`${run.label} timed out`)
      if (run.exitCode !== code) throw new Error(`${run.label} exited ${run.exitCode}, expected ${code}${run.spawnError ? ` (${run.spawnError})` : ''}`)
    },
    expectNoDialogs(run) {
      if (run.dialogs.length > 0) throw new Error(`unexpected dialog(s) during ${run.label}: ${JSON.stringify(run.dialogs)}`)
    },
    expectUserFiles(dir, seeded, when = 'after the run') {
      const problems = []
      for (const item of seeded) {
        const target = fromRel(dir, item.rel)
        if (item.emptyDir) {
          if (!isDir(target)) problems.push(`user folder missing: ${item.rel}`)
        } else if (!fs.existsSync(target)) {
          problems.push(`user file missing: ${item.rel}`)
        } else if (sha256File(target) !== item.sha256) {
          problems.push(`user file changed: ${item.rel}`)
        }
      }
      const flagged = seeded.filter((item) => (item.hidden || item.readonly) && fs.existsSync(fromRel(dir, item.rel)))
      if (flagged.length > 0) {
        const attributes = attributesOf(flagged.map((item) => fromRel(dir, item.rel)))
        flagged.forEach((item, index) => {
          if (item.hidden && !/Hidden/.test(attributes[index])) problems.push(`user file lost its hidden attribute: ${item.rel}`)
          if (item.readonly && !/ReadOnly/.test(attributes[index])) problems.push(`user file lost its read-only attribute: ${item.rel}`)
        })
      }
      if (problems.length > 0) throw new Error(`${when}: ${problems.join('; ')}`)
    },
    expectNoHoldingFolder(dir) {
      if (fs.existsSync(`${dir}${KEEP_SUFFIX}`)) {
        throw new Error(`holding folder left behind: ${dir}${KEEP_SUFFIX} (${fs.readdirSync(`${dir}${KEEP_SUFFIX}`).join(', ')})`)
      }
      if (pendingRecordExists()) throw new Error('pending-restore registry record left behind')
    },
    expectAppInstalled(dir) {
      const missing = manifest.files.filter((rel) => !fs.existsSync(fromRel(dir, rel)))
      if (missing.length > 0) throw new Error(`app files missing in ${dir}: ${missing.slice(0, 10).join(', ')}`)
      if (!fs.existsSync(path.join(dir, manifest.uninstallerFileName))) throw new Error(`uninstaller missing in ${dir}`)
      const asar = ['resources', 'app.asar']
      if (sha256File(path.join(dir, ...asar)) !== sha256File(path.join(state.unpacked, ...asar))) {
        throw new Error(`installed resources\\app.asar in ${dir} is not the build under test`)
      }
    },
    expectOldAppStillThere(dir) {
      for (const name of [appExe, manifest.uninstallerFileName, 'resources']) {
        if (!fs.existsSync(path.join(dir, name))) throw new Error(`the ${OLD_VERSION} installation lost ${name}`)
      }
    },
    expectAppGone(dir) {
      const left = [...manifest.files, manifest.uninstallerFileName].filter((rel) => fs.existsSync(fromRel(dir, rel)))
      if (left.length > 0) throw new Error(`installer files left in ${dir}: ${left.slice(0, 10).join(', ')}`)
    },
    /** 顶层条目恰好是：（安装器的条目，可选）+ 用户的条目。多一个是残渣，少一个是丢了。 */
    expectTopLevel(dir, userTopLevel, { app = true } = {}) {
      const expected = new Set([...(app ? [...manifest.topLevelNames, manifest.uninstallerFileName] : []), ...userTopLevel].map((name) => name.toLowerCase()))
      const actual = new Set(fs.readdirSync(dir).map((name) => name.toLowerCase()))
      const extra = [...actual].filter((name) => !expected.has(name))
      const missing = [...expected].filter((name) => !actual.has(name))
      if (extra.length > 0 || missing.length > 0) {
        throw new Error(`top level of ${dir}: unexpected [${extra.join(', ')}], missing [${missing.join(', ')}]`)
      }
    },
    expectRegistration(hive, dir, { version = manifest.version, marker = manifest.version } = {}) {
      const entry = registryEntries().find((item) => item.hive === hive)
      if (!entry) throw new Error(`no ${hive} registration`)
      if (entry.displayVersion !== version) throw new Error(`${hive} DisplayVersion is ${entry.displayVersion}, expected ${version}`)
      if (!samePath(entry.installLocation, dir)) throw new Error(`${hive} InstallLocation is ${entry.installLocation}, expected ${dir}`)
      if ((entry.marker || '') !== marker) throw new Error(`${hive} ${MARKER_VALUE_NAME} is "${entry.marker}", expected "${marker}"`)
    },
    expectNoRegistration() {
      const entries = registryEntries()
      if (entries.length > 0) throw new Error(`registry entries left behind: ${JSON.stringify(entries)}`)
      const left = powershell(`@('HKCU:', 'HKLM:') | ForEach-Object { if (Test-Path -LiteralPath ($_ + '\\Software\\' + ${psq(t.guid)})) { $_ } }`)
      if (left) throw new Error(`Software\\${t.guid} left behind in ${left}`)
    },
    expectNoShortcuts() {
      const left = shortcutPaths(manifest.productFilename).filter((file) => fs.existsSync(file))
      if (left.length > 0) throw new Error(`shortcuts left behind: ${left.join(', ')}`)
    },
    async lockFile(file) {
      const script = `$handle = [System.IO.File]::Open(${psq(file)}, 'Open', 'ReadWrite', 'None')
[Console]::Out.WriteLine('locked')
[Console]::Out.Flush()
try { while ($true) { Start-Sleep -Seconds 1 } } finally { $handle.Dispose() }`
      const helper = spawnPowerShell(['-EncodedCommand', encodedPowerShell(script)])
      const child = helper.child
      let released = false
      const release = async () => {
        if (released) return
        released = true
        const premature = helper.result.closed || child.exitCode !== null || child.signalCode !== null || helper.result.error
        if (!premature) killTree(child.pid)
        await helper.done
        if (premature) throw new Error(`setup: ${powerShellFailure(helper.result, 'lock helper ended before release')}`)
      }
      state.cleanups.push(release)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`setup: lock helper did not report: ${powerShellFailure(helper.result, 'lock helper')}`)), 60_000)
        child.stdout.on('data', () => {
          if (helper.result.stdout.split(/\r?\n/).includes('locked')) {
            clearTimeout(timer)
            resolve()
          }
        })
        helper.done.then((result) => {
          clearTimeout(timer)
          reject(new Error(`setup: ${powerShellFailure(result, 'lock helper')}`))
        })
      })
      return release
    },
    /** 场景结束时 resetMachine 会结束工作目录里起的所有进程，这里不另记清理（按进程号补杀可能误杀复用了号的进程）。 */
    async startApp(dir, cwd) {
      const child = spawn(path.join(dir, appExe), [], { cwd, detached: true, stdio: 'ignore' })
      child.unref()
      let aliveChecks = 0
      for (let i = 0; i < 120 && aliveChecks < 6; i += 1) {
        await sleep(500)
        aliveChecks = processesUnder(dir).length > 0 ? aliveChecks + 1 : 0
      }
      if (aliveChecks < 6) throw new Error(`setup: ${dir}\\${appExe} did not stay running`)
    },
    expectNoAppProcesses(dir) {
      const left = processesUnder(dir)
      if (left.length > 0) throw new Error(`processes still running from ${dir}: ${JSON.stringify(left)}`)
    },
    requireElevation() {
      if (!isElevated()) throw new Error('setup: the per-machine scenario needs an elevated runner (GitHub-hosted Windows runners are)')
    },
    /** 模拟修好的安装程序挪开了一部分条目后被杀：旁边目录 + 说明文件 + 待恢复记录。 */
    async lateDeleter(dir) {
      t.requireElevation()
      const gateDir = path.join(root, 'gate')
      fs.mkdirSync(gateDir, { recursive: true })
      const debuggerCommand = `"${process.execPath}" "${path.join(repoRoot, 'tests', 'installer', 'late-deleter-gate.mjs')}" --state "${gateDir}" --`
      powershell(`foreach ($key in @(${IFEO_KEYS.map(psq).join(', ')})) { if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }; New-ItemProperty -LiteralPath $key -Name Debugger -Value ${psq(debuggerCommand)} -PropertyType String -Force | Out-Null }`)
      let parent
      const first = runInstaller(state, newExe, ['--updated', '/S'], 'update interrupted while its uninstaller is held', (child) => { parent = child })
      // Observe the promise immediately, including preparation failures before spawn.
      let firstResult, firstError
      const firstDone = first.then((v) => { firstResult = v }, (e) => { firstError = e })
      let captured
      state.cleanups.push(async () => {
        clearIfeo()
        fs.writeFileSync(path.join(gateDir, 'release'), 'release')
        await firstDone
        if (captured) await waitForFile(path.join(gateDir, 'finished.json'), null, 'gate cleanup')
      })
      captured = await waitForFile(path.join(gateDir, 'held.json'), () => {
        if (firstError) throw firstError
        if (firstResult) throw new Error(`setup: installer ended before IFEO held the uninstaller: ${JSON.stringify(firstResult)}`)
      }, 'IFEO held signal')
      state.current.gate = captured
      clearIfeo()
      if (!parent?.pid) throw new Error('setup: installer parent PID missing')
      const killed = spawnSync('taskkill', ['/PID', String(parent.pid), '/F'], { encoding: 'utf8' })
      if (killed.status !== 0) throw new Error(`setup: parent-only taskkill failed: ${killed.stdout} ${killed.stderr}`)
      await firstDone
      if (firstError) throw firstError
      if (firstResult.timedOut || firstResult.spawnError) throw new Error(`setup: failed interrupted installer: ${JSON.stringify(firstResult)}`)
      t.expectNoDialogs(firstResult)
      const rerun = await t.upgrade('second update while the first uninstaller remains held')
      t.expectExit(rerun, 0)
      t.expectNoDialogs(rerun)
      fs.writeFileSync(path.join(gateDir, 'release'), 'release')
      const finished = await waitForFile(path.join(gateDir, 'finished.json'), null, 'late uninstaller exit')
      state.current.lateExit = finished
      if (finished.error || finished.exitCode !== 0) throw new Error(`late uninstaller failed: ${JSON.stringify(finished)}`)
      return captured
    },
    expectGateImage(captured) {
      const expected = sha256File(state.safeUninstaller)
      if (captured.sha256 !== expected) throw new Error(`held image is not the current uninstaller: ${captured.sha256}, expected ${expected}`)
    },
    simulateMovedAside(dir, names) {
      const holding = `${dir}${KEEP_SUFFIX}`
      fs.mkdirSync(holding, { recursive: true })
      fs.writeFileSync(path.join(holding, KEEP_README), 'written by the scenario runner to simulate an interrupted update\r\n')
      for (const name of names) fs.renameSync(path.join(dir, name), path.join(holding, name))
      setRegistryValue('HKCU', `Software\\${t.guid}${KEEP_SUFFIX}`, `${PENDING_VALUE_PREFIX}1`, dir)
    },
  }
  return t
}

/** 场景执行器：键 = scenarios.mjs 的 id；普查测试核对两边一一对应。 */
export const SCENARIO_RUNNERS = Object.freeze({
  async 'old-to-new-user-folder'(t) {
    const dir = path.join(t.root, 'Nomi_new')
    await t.installOld(dir)
    const places = t.seedPlaces(dir, [...INCIDENT_FILES, ...NESTED_FILES])
    const run = await t.upgrade()
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectPlaces(places, 'after the upgrade')
    t.expectNoHoldingFolder(dir)
    t.expectTopLevel(dir, INCIDENT_TOP_LEVEL)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
    const removal = await t.uninstall(dir)
    t.expectExit(removal, 0)
    t.expectNoDialogs(removal)
    t.expectPlaces(places, 'after uninstalling')
    t.expectAppGone(dir)
    t.expectTopLevel(dir, [...INCIDENT_TOP_LEVEL, 'resources', 'locales'], { app: false })
    t.expectNoRegistration()
  },

  async 'old-to-new-dir-full-of-user-files'(t) {
    const dir = path.join(t.root, '我的 工作')
    const seeded = t.seed(dir, FULL_DIR_FILES)
    await t.installOld(dir)
    t.expectUserFiles(dir, seeded, `after installing ${OLD_VERSION} into the folder`)
    const run = await t.upgrade()
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectUserFiles(dir, seeded, 'after the upgrade')
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
    const removal = await t.uninstall(dir)
    t.expectExit(removal, 0)
    t.expectNoDialogs(removal)
    t.expectUserFiles(dir, seeded, 'after uninstalling')
    t.expectAppGone(dir)
    t.expectNoRegistration()
  },

  async 'old-to-new-app-still-running'(t) {
    const dir = path.join(t.root, 'Nomi_run')
    await t.installOld(dir)
    const seeded = t.seed(dir, INCIDENT_FILES)
    // 以项目文件夹为工作目录：应用没退干净时，这个文件夹是改不了名的。挪开必须排在「结束应用」之后。
    await t.startApp(dir, path.join(dir, 'xiangmu'))
    const run = await t.upgrade('upgrade while the old app is running')
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectNoAppProcesses(dir)
    t.expectUserFiles(dir, seeded)
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
  },

  async 'old-to-new-locked-user-file'(t) {
    const dir = path.join(t.root, 'Nomi_lock')
    await t.installOld(dir)
    const seeded = t.seed(dir, INCIDENT_FILES)
    const release = await t.lockFile(fromRel(dir, 'xiangmu\\proj1\\.nomi\\project.json'))
    const blocked = await t.upgrade('upgrade with a locked user file')
    await release()
    t.expectExit(blocked, 2)
    if (blocked.dialogs.length !== 1 || !blocked.dialogs[0].text.includes('xiangmu')) {
      throw new Error(`expected exactly one dialog naming xiangmu in silent mode, got ${JSON.stringify(blocked.dialogs)}`)
    }
    t.expectUserFiles(dir, seeded, 'after the aborted upgrade')
    t.expectNoHoldingFolder(dir)
    t.expectOldAppStillThere(dir)
    t.expectRegistration('HKCU', dir, { version: OLD_VERSION, marker: '' })
    const retry = await t.upgrade('retry after the lock is released')
    t.expectExit(retry, 0)
    t.expectNoDialogs(retry)
    t.expectUserFiles(dir, seeded, 'after the retry')
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
  },

  async 'old-to-new-changed-dir'(t) {
    const oldDir = path.join(t.root, 'Nomi_old')
    const newDir = path.join(t.root, 'Nomi_moved')
    await t.installOld(oldDir)
    const seeded = t.seed(oldDir, INCIDENT_FILES)
    const run = await t.reinstallTo(newDir)
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectUserFiles(oldDir, seeded)
    t.expectTopLevel(oldDir, INCIDENT_TOP_LEVEL, { app: false })
    t.expectNoHoldingFolder(oldDir)
    t.expectNoHoldingFolder(newDir)
    t.expectAppInstalled(newDir)
    t.expectRegistration('HKCU', newDir)
  },

  async 'old-to-new-per-machine'(t) {
    t.requireElevation()
    const dir = path.join(t.root, 'NomiPM')
    await t.installOld(dir, { allUsers: true })
    const seeded = t.seed(dir, INCIDENT_FILES)
    const run = await t.upgrade()
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectUserFiles(dir, seeded)
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKLM', dir)
    const removal = await t.uninstall(dir, { allUsers: true })
    t.expectExit(removal, 0)
    t.expectUserFiles(dir, seeded, 'after uninstalling')
  },

  async 'old-to-new-stale-marker'(t) {
    const dir = path.join(t.root, 'Nomi_stale')
    await t.installOld(dir)
    const seeded = t.seed(dir, INCIDENT_FILES)
    // 标记的值等于新版本号、却不等于登记着的 0.24.0：只信「当前登记的那一版写的」标记。
    setRegistryValue('HKCU', `Software\\${t.guid}`, MARKER_VALUE_NAME, t.newVersion)
    const run = await t.upgrade()
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectUserFiles(dir, seeded)
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
  },

  async 'old-to-new-no-foreign-then-uninstall'(t) {
    const dir = path.join(t.root, 'Clean')
    await t.installOld(dir)
    const run = await t.upgrade()
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectTopLevel(dir, [])
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
    const removal = await t.uninstall(dir)
    t.expectExit(removal, 0)
    t.expectNoDialogs(removal)
    if (fs.existsSync(dir)) throw new Error(`residue: ${dir} still exists after uninstalling (${fs.readdirSync(dir).join(', ')})`)
    t.expectNoRegistration()
    t.expectNoShortcuts()
  },

  async 'interrupted-after-replace'(t) {
    const dir = path.join(t.root, 'Nomi_int1')
    await t.installOld(dir)
    const seeded = t.seed(dir, INCIDENT_FILES)
    t.simulateMovedAside(dir, INCIDENT_TOP_LEVEL)
    const oldRemoval = await t.uninstall(dir, { label: `setup: the ${OLD_VERSION} uninstaller finishes after the installer was killed` })
    t.expectExit(oldRemoval, 0)
    if (fs.existsSync(dir)) throw new Error(`setup: the ${OLD_VERSION} uninstaller should have removed ${dir}`)
    const run = await t.upgrade('next update run')
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectUserFiles(dir, seeded, 'after the next update run')
    t.expectNoHoldingFolder(dir)
    const entry = registryEntries().find((item) => item.hive === 'HKCU')
    if (!entry) throw new Error('the next update run did not install Nomi')
    t.expectAppInstalled(entry.installLocation)
  },

  async 'interrupted-after-replaced-uninstaller-ran'(t) {
    const dir = path.join(t.root, 'Nomi_int2')
    await t.installOld(dir)
    const seeded = t.seed(dir, INCIDENT_FILES)
    t.simulateMovedAside(dir, ['xiangmu'])
    const run = await t.upgrade('next update run')
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectUserFiles(dir, seeded)
    t.expectTopLevel(dir, INCIDENT_TOP_LEVEL)
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
  },

  async 'late-deleter-after-killed-installer'(t) {
    const dir = path.join(t.root, 'Late')
    await t.installOld(dir)
    const oldHash = sha256File(path.join(dir, t.manifest.uninstallerFileName))
    const places = t.seedPlaces(dir, [...INCIDENT_FILES, ...NESTED_FILES])
    const captured = await t.lateDeleter(dir)
    // The characterization records which real image was intercepted even when data loss is the first failure.
    captured.wasLegacy = captured.sha256 === oldHash
    t.expectPlaces(places, 'after the late deleter finished')
    t.expectGateImage(captured)
    const final = await t.reinstallTo(dir, 'reinstall after the late uninstaller removed registration')
    t.expectExit(final, 0)
    t.expectNoDialogs(final)
    t.expectPlaces(places, 'after reinstalling')
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
    t.expectNoHoldingFolder(dir)
  },

  async 'unowned-sidecar-untouched'(t) {
    const dir = path.join(t.root, 'Sidecar')
    await t.installOld(dir)
    const seeded = t.seed(dir, INCIDENT_FILES)
    const sidecar = `${dir}.nomi-keep`
    const sideFiles = t.seed(sidecar, [
      { rel: 'NOMI-INSTALLER-KEEP.txt', text: '用户自己的说明文件，不属于安装器' },
      { rel: '私人.txt', text: 'private user content' },
      { rel: '子目录\\b.txt', text: 'nested user content' },
    ])
    const snapshot = () => fs.readdirSync(sidecar, { recursive: true }).sort()
    const before = snapshot()
    const check = () => {
      t.expectUserFiles(sidecar, sideFiles, 'unowned sidecar')
      if (JSON.stringify(snapshot()) !== JSON.stringify(before)) throw new Error('unowned sidecar entries changed')
      if (fs.existsSync(path.join(dir, '私人.txt'))) throw new Error('unowned sidecar was moved into the install folder')
      t.expectUserFiles(dir, seeded)
    }
    const run = await t.upgrade()
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    check()
    const removal = await t.uninstall(dir)
    t.expectExit(removal, 0)
    t.expectNoDialogs(removal)
    check()
  },

  async 'new-to-new-update'(t) {
    const dir = path.join(t.root, 'Nomi')
    await t.installNew(dir)
    const places = t.seedPlaces(dir, [
      ...INCIDENT_FILES,
      { rel: 'resources\\user-notes\\a.txt', text: 'kept inside an installer folder' },
      { rel: 'locales\\my.txt', text: 'kept inside another installer folder' },
    ])
    const release = await t.lockFile(fromRel(dir, 'xiangmu\\proj1\\.nomi\\project.json'))
    const run = await t.upgrade('update the build under test over itself')
    await release()
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectPlaces(places, 'after the update')
    t.expectNoHoldingFolder(dir)
    t.expectAppInstalled(dir)
    t.expectRegistration('HKCU', dir)
    const removal = await t.uninstall(dir)
    t.expectExit(removal, 0)
    t.expectNoDialogs(removal)
    t.expectPlaces(places, 'after uninstalling')
    t.expectAppGone(dir)
    t.expectNoRegistration()
  },

  async 'new-to-new-changed-dir'(t) {
    const first = path.join(t.root, 'A')
    const second = path.join(t.root, 'B')
    await t.installNew(first)
    const seeded = t.seed(first, INCIDENT_FILES)
    const run = await t.reinstallTo(second)
    t.expectExit(run, 0)
    t.expectNoDialogs(run)
    t.expectUserFiles(first, seeded)
    t.expectTopLevel(first, INCIDENT_TOP_LEVEL, { app: false })
    t.expectAppInstalled(second)
    t.expectRegistration('HKCU', second)
  },

  async 'new-uninstall-keeps-user-files'(t) {
    const dir = path.join(t.root, 'Nomi')
    await t.installNew(dir)
    const seeded = t.seed(dir, [...INCIDENT_FILES, { rel: 'resources\\user-notes\\a.txt', text: 'kept inside an installer folder' }])
    const removal = await t.uninstall(dir)
    t.expectExit(removal, 0)
    t.expectNoDialogs(removal)
    t.expectUserFiles(dir, seeded, 'after uninstalling')
    t.expectAppGone(dir)
    const holdsUserFiles = (rel) => seeded.some((item) => item.rel.toLowerCase().startsWith(`${rel.toLowerCase()}\\`))
    const leftDirs = t.manifest.dirs.filter((rel) => isDir(fromRel(dir, rel)) && !holdsUserFiles(rel))
    if (leftDirs.length > 0) throw new Error(`installer folders left behind: ${leftDirs.slice(0, 10).join(', ')}`)
    t.expectNoRegistration()
    t.expectNoShortcuts()
  },
})

async function runScenario(state, scenario, newExe) {
  const record = { id: scenario.id, card: scenario.card, title: scenario.title, ok: false, runs: [] }
  state.current = record
  state.cleanups = []
  const started = performance.now()
  try {
    resetMachine(state)
    const root = path.join(state.work, 's', scenario.card)
    fs.mkdirSync(root, { recursive: true })
    await SCENARIO_RUNNERS[scenario.id](scenarioContext(state, root, newExe))
    record.ok = true
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error)
  } finally {
    for (const cleanup of state.cleanups.splice(0)) {
      try {
        await cleanup()
      } catch (error) {
        record.ok = false
        record.cleanupError = String(error)
      }
    }
    try {
      resetMachine(state)
    } catch (error) {
      record.ok = false
      record.cleanupError = String(error)
    }
    record.durationMs = Math.round(performance.now() - started)
  }
  console.log(`${record.ok ? 'PASS' : 'FAIL'} ${scenario.card} ${scenario.id} (${record.durationMs}ms)${record.ok ? '' : `\n    ${record.error ?? record.cleanupError}`}`)
  return record
}

/** 反例：临时改一份 installer.nsh → --prepackaged 重打安装包 → 跑预期该红的场景，必须红在 failureMatch。 */
async function runCounterexamples(state) {
  const results = []
  const builderCli = createRequire(import.meta.url).resolve('electron-builder/cli.js')
  const source = fs.readFileSync(path.join(repoRoot, 'build', 'installer.nsh'), 'utf8')
  for (const counterexample of COUNTEREXAMPLES) {
    const dir = path.join(repoRoot, '.tmp', 'installer-cx', counterexample.id)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const include = path.join(dir, 'installer.nsh')
    fs.writeFileSync(include, applyMutation(source, counterexample))
    const output = path.join(dir, 'out')
    console.log(`▶ ${counterexample.card} ${counterexample.id}: building a mutated installer`)
    // 不压缩只为省时间：压缩方式不进安装逻辑，同一份打包目录、同一套模板，只差改过的那一句。
    const build = spawnSync(process.execPath, [builderCli, '--prepackaged', state.unpacked, '--win', 'nsis', '--x64', '--publish', 'never', `-c.nsis.include=${include}`, `-c.directories.output=${output}`, '-c.compression=store'], { cwd: repoRoot, stdio: 'inherit' })
    const built = path.join(output, state.installerName)
    if (build.status !== 0 || !fs.existsSync(built)) {
      results.push({ id: counterexample.id, card: counterexample.card, expectRed: counterexample.expectRed, wentRed: false, error: `the mutated installer did not build (exit ${build.status})` })
      continue
    }
    const exe = path.join(state.work, 'bin', `nomi-cx-setup-${counterexample.card}.exe`)
    fs.copyFileSync(built, exe)
    const scenario = SCENARIOS.find((item) => item.id === counterexample.expectRed)
    const outcome = await runScenario(state, scenario, exe)
    const wentRed = !outcome.ok && !outcome.cleanupError && String(outcome.error).includes(counterexample.failureMatch)
    console.log(`${wentRed ? 'RED as expected' : 'NOT RED'} ${counterexample.card} ${counterexample.id} → ${counterexample.expectRed}`)
    results.push({ id: counterexample.id, card: counterexample.card, expectRed: counterexample.expectRed, wentRed, error: outcome.error ?? null, runs: outcome.runs })
  }
  return results
}

function parseArgs(argv) {
  const args = { counterexamples: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--counterexamples') args.counterexamples = true
    else if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1]
      i += 1
    }
  }
  return args
}

function verifyChecksum(file, sumsFile) {
  const name = path.basename(file)
  const line = fs.readFileSync(sumsFile, 'utf8').split(/\r?\n/).find((row) => row.trim().endsWith(`  ${name}`) || row.trim().endsWith(` *${name}`))
  if (!line) throw new Error(`${name} is not listed in ${sumsFile}`)
  const expected = line.trim().split(/\s+/)[0].toLowerCase()
  const actual = sha256File(file)
  if (expected !== actual) throw new Error(`${name} checksum mismatch: expected ${expected}, got ${actual}`)
}

function writeSummary(report) {
  const lines = ['## Windows installer scenarios', '', `build under test: ${report.version}; old installer: v${OLD_VERSION}`, '', '| card | scenario | result | duration |', '|---|---|---|---|']
  for (const item of report.scenarios) lines.push(`| ${item.card} | ${item.id} | ${item.ok ? 'pass' : `**fail**: ${String(item.error).replaceAll('|', '\\|').slice(0, 300)}`} | ${Math.round(item.durationMs / 1000)}s |`)
  if (report.counterexamples.length > 0) {
    lines.push('', '| counterexample | expected red | went red |', '|---|---|---|')
    for (const item of report.counterexamples) lines.push(`| ${item.card} ${item.id} | ${item.expectRed} | ${item.wentRed ? 'yes' : `**no**: ${String(item.error).replaceAll('|', '\\|').slice(0, 300)}`} |`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (process.platform !== 'win32') {
    console.error('windows-installer-scenarios: Windows only (see .github/workflows/win-installer.yml)')
    process.exit(2)
  }
  for (const key of ['old', 'old-sums', 'new', 'manifest', 'unpacked', 'work', 'report']) {
    if (!args[key]) {
      console.error(`windows-installer-scenarios: missing --${key}`)
      process.exit(2)
    }
  }
  const work = path.resolve(args.work)
  if (/\s/.test(work)) throw new Error(`--work must not contain spaces: ${work}`)
  fs.mkdirSync(path.join(work, 'bin'), { recursive: true })
  verifyChecksum(path.resolve(args.old), path.resolve(args['old-sums']))
  const oldExe = path.join(work, 'bin', 'nomi-old-setup.exe')
  const newExe = path.join(work, 'bin', 'nomi-new-setup.exe')
  fs.copyFileSync(path.resolve(args.old), oldExe)
  fs.copyFileSync(path.resolve(args.new), newExe)
  const manifest = JSON.parse(fs.readFileSync(path.resolve(args.manifest), 'utf8'))
  // 被测包必须和旧版不同号：A7 要的是「标记不是当前登记的那一版写的」，同号时这个场景量不到任何东西（工作流会先改一个测试版本号）。
  if (manifest.version === OLD_VERSION) throw new Error(`the build under test is version ${OLD_VERSION}, the same as the old installer; give it its own version first (see .github/workflows/win-installer.yml)`)
  // 「默认位置」= Electron app.getPath('documents') 那个目录（同一个系统已知文件夹）。
  const documents = powershell("[Environment]::GetFolderPath('MyDocuments')")
  if (!documents || !path.isAbsolute(documents)) throw new Error(`cannot resolve the Documents folder: "${documents}"`)
  const projectsRoot = path.join(documents, DEFAULT_PROJECTS_FOLDER)
  const projectsRootExisted = fs.existsSync(projectsRoot)
  const state = { work, manifest, unpacked: path.resolve(args.unpacked), installerName: path.basename(args.new), oldExe, newExe, documents, outsideSeeds: [], runCounter: 0, uninstallCounter: 0, guid: null, current: null, cleanups: [] }
  const selected = args.only ? SCENARIOS.filter((scenario) => scenario.id === args.only) : SCENARIOS
  if (selected.length === 0) throw new Error(`no scenario matches --only ${args.only}`)
  state.current = { runs: [] }
  resetMachine(state)
  const probe = path.join(state.work, 's', 'probe')
  await scenarioContext(state, probe, newExe).installNew(probe)
  state.safeUninstaller = path.join(state.work, 'bin', 'nomi-current-uninstaller.exe')
  fs.copyFileSync(path.join(probe, manifest.uninstallerFileName), state.safeUninstaller)
  resetMachine(state)
  const scenarios = []
  for (const scenario of selected) {
    console.log(`▶ ${scenario.card} ${scenario.id}: ${scenario.title}`)
    scenarios.push(await runScenario(state, scenario, newExe))
  }
  const counterexamples = args.counterexamples ? await runCounterexamples(state) : []
  // 「文档」\Nomi Projects 是本次跑才建出来的，就把它删掉（只在已经空了时；里面有别的东西就留着）。
  if (!projectsRootExisted) {
    try {
      fs.rmdirSync(projectsRoot)
    } catch {
      // 不存在或不空：都不动
    }
  }
  const report ={ version: manifest.version, oldVersion: OLD_VERSION, only: args.only ?? null, scenarios, counterexamples }
  fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true })
  fs.writeFileSync(path.resolve(args.report), `${JSON.stringify(report, null, 2)}\n`)
  writeSummary(report)
  const failures = scenarios.filter((item) => !item.ok).length + counterexamples.filter((item) => !item.wentRed).length
  process.exitCode = failures > 0 ? 1 : 0
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
