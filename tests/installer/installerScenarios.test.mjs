// Windows 安装器的普查（设计卡 ★9 的 M3 与反例 CX5–CX7）：docs/plan/2026-10-29-installer-keep-user-files.md。
//
// 真装真升真卸只能在 .github/workflows/win-installer.yml 的 Windows 作业里跑；这里在默认 vitest 车道（任何平台）守住
// 「那个作业量的东西还是对的」：
//   · 任务书点名的每个覆盖面都有场景认领，场景登记 ↔ 执行器 ↔ 设计卡 ★9 表一一对应；
//   · 工作流在 windows-latest 上跑全部场景、反例开着、不带 --only，旧版是 v0.24.0；
//   · 它是发版硬门：desktop-rc.yml 恰好一个作业无条件调用它、finalize 依赖它，desktop-release.yml 只晋级 success 的候选版；
//   · 执行器种「默认位置」用户数据的地方，还是应用代码里新项目的默认位置（「文档」\Nomi Projects）；
//   · build/installer.nsh 没有 `RMDir /r`、6 个钩子都在，常量和 scenarios.mjs 逐字一致，引入的清单路径就是生成器写的路径；
//   · package.json 的打包配置还是 installer.nsh 能处理的形状；
//   · 每个反例要改的那一句在 installer.nsh 里恰好一处；
//   · electron-builder 的 NSIS 模板逐字节没变（installer.nsh 依赖它的钩子顺序和宏名）。
// 每条判据都配一条「必红」自检：拿改坏的副本喂进去，必须报出来。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { registerInstallerCompileTests } from '../../scripts/packaging/installer-compile.cases.mjs'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { COUNTEREXAMPLES, DEFAULT_PROJECTS_FOLDER, KEEP_README, KEEP_SUFFIX, MARKER_VALUE_NAME, PENDING_VALUE_PREFIX, REQUIRED_COVERAGE, SCENARIOS } from './scenarios.mjs'
import { OLD_VERSION, SCENARIO_RUNNERS, applyMutation } from './windows-installer-scenarios.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)
const { manifestPaths, renderNsh } = require('../../scripts/packaging/installer-manifest.cjs')

const INSTALLER_NSH = 'build/installer.nsh'
const WORKFLOW = '.github/workflows/win-installer.yml'
const RC_WORKFLOW = '.github/workflows/desktop-rc.yml'
const RELEASE_WORKFLOW = '.github/workflows/desktop-release.yml'
const CALLED_AS = `./${WORKFLOW}`
const DESIGN_CARD = 'docs/plan/2026-10-29-installer-keep-user-files.md'
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')

const temps = []
afterEach(() => {
  for (const dir of temps.splice(0)) cleanupTestTemp(dir)
})

/**
 * electron-builder 26.15.3 的 NSIS 模板指纹。build/installer.nsh 依赖的东西都在这几个文件里：钩子的插入点与顺序
 * （customHeader / customCheckAppRunning / customUnInstallCheck* / customRemoveFiles / customInstall）、
 * 照抄的默认处理（installUtil.nsh 的 handleUninstallResult、uninstaller.nsh 的原子挪走）、原样调用的宏
 * （IS_POWERSHELL_AVAILABLE / _CHECK_APP_RUNNING / GetProcessInfo）。
 * 这里红了：逐个重读变了的文件，确认上面每一条还成立，必要时改 installer.nsh；再更新这张表——
 * 改 tests/installer/ 下的文件会触发 Windows 安装作业，真装真升真卸再验一遍。
 */
const TEMPLATE_FINGERPRINTS = Object.freeze({
  'installer.nsi': '8811964416d122612c3e7601728af5d3f998d677918df829a4e8b4c739c8b9f8',
  'installSection.nsh': '74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072',
  'uninstaller.nsh': '9ee2dac4593478083e8aa6f8487287ce9401006ccd50ecc538871d133ea4a42c',
  'assistedInstaller.nsh': '8aa1230e9717b428664d613fcc5c6a060883410b34cb7853b517fe11b4ee0a76',
  'multiUser.nsh': '9aca256695c289ec8a875143101fae8c6236bc8c6a7cf369bbe8b4986e09c9cb',
  'multiUserUi.nsh': 'f7a4524244e68dc0782a759e076e5e55fadef0f22bbccf33100a4ab59d69c066',
  'common.nsh': '281e8071663d2ef3e9f00bb27e6ef09d2c2b52b85458da07082f2b186100e259',
  'include/installUtil.nsh': '97bd546b5cd2aaf16b77bc9e2be8a18962dd74ab5c4d23b35b163ca89bf4dd2a',
  'include/installer.nsh': '0e319437dd01dcbf911f3f48f664fde0cefbaef704f1cdb1739f63d563f5d4a0',
  'include/extractAppPackage.nsh': 'e4174388a0f7a1df0b85a0742aa1ea7a4b2b18f9f29dccd6ef10a66212f68148',
  'include/allowOnlyOneInstallerInstance.nsh': '0d4ae12cf0bd177cb85cb77680add3135108ddd21ab5730426e4600e2aaad18f',
  'include/getProcessInfo.nsh': '1aa6bd7afc8b82534c26c878d2716fd12b7e215b11e2d5becd0d605085b88590',
})

/** 打包时真正用的那份模板：electron-builder 自己解析到的 app-builder-lib（仓库里可能同时装着别的版本）。 */
function templateDir() {
  const builderDir = path.dirname(require.resolve('electron-builder/package.json'))
  const libPackage = createRequire(path.join(builderDir, 'package.json')).resolve('app-builder-lib/package.json')
  return path.join(path.dirname(libPackage), 'templates', 'nsis')
}

function fingerprintProblems(dir) {
  return Object.entries(TEMPLATE_FINGERPRINTS).flatMap(([rel, expected]) => {
    const file = path.join(dir, ...rel.split('/'))
    if (!fs.existsSync(file)) return [`${rel}: missing`]
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    return actual === expected ? [] : [`${rel}: ${actual}`]
  })
}

/** NSIS 源码只留指令：去掉 /* *\/ 块注释、以 ; 或 # 开头的注释（整行或行尾），引号里的内容换成空格。 */
function nsisCode(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => {
    let out = ''
    let quote = null
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quote) {
        if (ch === '$' && line[i + 1] === '\\' && line[i + 2] === quote) {
          out += '   '
          i += 2
        } else if (ch === quote) {
          quote = null
          out += ch
        } else {
          out += ' '
        }
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch
        out += ch
        continue
      }
      if ((ch === ';' || ch === '#') && (i === 0 || /\s/.test(line[i - 1]))) break
      out += ch
    }
    return out
  }).join('\n')
}

/** 递归删目录的指令（RMDir 带 /r，不管和别的开关怎么排）。注释和字符串里提到的不算。 */
function recursiveRemovals(source) {
  const hits = []
  nsisCode(source).split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\bRMDir\b((?:\s+\/[A-Za-z]+)+)/gi)) {
      if (/\/r\b/i.test(match[1])) hits.push(`line ${index + 1}: ${line.trim()}`)
    }
  })
  return hits
}

const HOOKS = ['customHeader', 'customCheckAppRunning', 'customUnInstallCheck', 'customUnInstallCheckCurrentUser', 'customRemoveFiles', 'customInstall']

function hookCounts(source) {
  const code = nsisCode(source)
  return Object.fromEntries(HOOKS.map((hook) => [hook, [...code.matchAll(new RegExp(`^\\s*!macro\\s+${hook}\\b`, 'gm'))].length]))
}

/** 工作流判据：Windows 上跑执行器、全部场景、反例开着、旧版对、参数齐、推送路径罩住安装器相关文件。返回问题清单。 */
function workflowProblems(text) {
  const problems = []
  const workflow = yaml.load(text)
  const jobs = Object.values(workflow.jobs ?? {})
  const steps = jobs.filter((job) => job['runs-on'] === 'windows-latest').flatMap((job) => job.steps ?? [])
  const runner = steps.filter((step) => typeof step.run === 'string' && step.run.includes('tests/installer/windows-installer-scenarios.mjs'))
  if (runner.length !== 1) problems.push(`expected one windows-latest step running the scenario runner, found ${runner.length}`)
  for (const step of runner) {
    if (!/(^|\s)--counterexamples(\s|$)/.test(step.run)) problems.push('the runner step does not pass --counterexamples')
    if (/(^|\s)--only(\s|=|$)/.test(step.run)) problems.push('the runner step passes --only (every scenario must run)')
    for (const flag of ['--old', '--old-sums', '--new', '--manifest', '--unpacked', '--work', '--report']) {
      if (!new RegExp(`(^|\\s)${flag}\\s`).test(step.run)) problems.push(`the runner step is missing ${flag}`)
    }
  }
  if (!steps.some((step) => typeof step.run === 'string' && step.run.includes(`gh release download v${OLD_VERSION} `))) {
    problems.push(`no step downloads the v${OLD_VERSION} release installer`)
  }
  const triggers = workflow.on ?? {}
  if (!('workflow_dispatch' in triggers)) problems.push('workflow_dispatch trigger missing')
  if (!('workflow_call' in triggers)) problems.push(`workflow_call trigger missing (${RC_WORKFLOW} calls this workflow as a release gate)`)
  const paths = triggers.push?.paths ?? []
  const covered = (file) => paths.some((pattern) => (pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : pattern === file))
  for (const file of [INSTALLER_NSH, 'scripts/packaging/installer-manifest.cjs', 'scripts/after-pack-mac.cjs', 'tests/installer/scenarios.mjs', 'tests/installer/windows-installer-scenarios.mjs', 'tests/installer/dialog-watcher.ps1', 'tests/installer/installerScenarios.test.mjs', WORKFLOW]) {
    if (!covered(file)) problems.push(`push.paths does not cover ${file}`)
  }
  return problems
}

/** 发版硬门判据：候选版工作流恰好一个作业调用本工作流、不带条件，finalize 依赖它。返回问题清单。 */
function releaseGateProblems(text) {
  const problems = []
  const jobs = yaml.load(text).jobs ?? {}
  const callers = Object.entries(jobs).filter(([, job]) => job.uses === CALLED_AS)
  if (callers.length !== 1) problems.push(`expected one ${RC_WORKFLOW} job calling ${CALLED_AS}, found ${callers.length}`)
  for (const [id, job] of callers) {
    if (job.if !== undefined) problems.push(`the ${id} job has a condition (${job.if}); the release gate must run on every candidate`)
    if (![].concat(jobs.finalize?.needs ?? []).includes(id)) problems.push(`finalize does not need ${id}, so a red installer run would not stop the candidate`)
  }
  return problems
}

describe('installer scenario registry', () => {
  it('every coverage area the brief names is claimed by at least one scenario, and scenarios only claim registered areas', () => {
    const claimed = new Set(SCENARIOS.flatMap((scenario) => scenario.covers))
    expect(Object.keys(REQUIRED_COVERAGE).filter((area) => !claimed.has(area))).toEqual([])
    expect([...claimed].filter((area) => !Object.hasOwn(REQUIRED_COVERAGE, area))).toEqual([])
  })

  it('scenario ids and card numbers are unique, and the runner has exactly one function per scenario', () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(SCENARIOS.length)
    expect(new Set(SCENARIOS.map((scenario) => scenario.card)).size).toBe(SCENARIOS.length)
    for (const scenario of SCENARIOS) {
      expect(scenario.card).toMatch(/^A\d+$/)
      expect(scenario.title.length).toBeGreaterThan(0)
      expect(typeof SCENARIO_RUNNERS[scenario.id]).toBe('function')
    }
    expect(Object.keys(SCENARIO_RUNNERS).sort()).toEqual(SCENARIOS.map((scenario) => scenario.id).sort())
  })

  it('matches the ★9 table of the design card row for row', () => {
    const rows = [...read(DESIGN_CARD).matchAll(/^\| (A\d+) \| `([a-z0-9-]+)` \|/gm)].map((match) => [match[1], match[2]])
    expect(Object.fromEntries(rows)).toEqual(Object.fromEntries(SCENARIOS.map((scenario) => [scenario.card, scenario.id])))
  })
})

describe('Windows installer workflow', () => {
  it('runs every scenario and the counterexamples on windows-latest against the v0.24.0 release, on pushes that touch the installer', () => {
    expect(workflowProblems(read(WORKFLOW))).toEqual([])
  })

  it('points the runner at the installer and manifest this repository actually builds', () => {
    const pkg = JSON.parse(read('package.json'))
    const productName = pkg.build.productName
    const installer = pkg.build.artifactName.replace('${productName}', productName).replace('${os}', 'win').replace('${arch}', 'x64').replace('${ext}', 'exe')
    const manifestJson = path.relative(repoRoot, manifestPaths(repoRoot, productName, 'x64').json).split(path.sep).join('\\')
    const run = yaml.load(read(WORKFLOW)).jobs.scenarios.steps.find((step) => step.run?.includes('windows-installer-scenarios.mjs')).run
    expect(run).toContain(`--new ${pkg.build.directories.output}\\${installer}`)
    expect(run).toContain(`--manifest ${manifestJson}`)
    expect(run).toContain(`--unpacked ${pkg.build.directories.output}\\win-unpacked`)
  })

  it('CX7: the workflow check goes red when the runner is narrowed to one scenario or loses the counterexamples', () => {
    const text = read(WORKFLOW)
    expect(workflowProblems(text.replaceAll('--counterexamples', '--counterexamples --only old-to-new-user-folder'))).toContain('the runner step passes --only (every scenario must run)')
    expect(workflowProblems(text.replaceAll('--counterexamples', ''))).toContain('the runner step does not pass --counterexamples')
    expect(workflowProblems(text.replaceAll('runs-on: windows-latest', 'runs-on: ubuntu-latest'))).toContain('expected one windows-latest step running the scenario runner, found 0')
    expect(workflowProblems(text.replaceAll('      - tests/installer/**\n', ''))).toContain('push.paths does not cover tests/installer/scenarios.mjs')
    expect(workflowProblems(text.replaceAll(`v${OLD_VERSION} `, 'v0.23.9 '))).toContain(`no step downloads the v${OLD_VERSION} release installer`)
    expect(workflowProblems(text.replace('  workflow_call:\n', ''))).toContain(`workflow_call trigger missing (${RC_WORKFLOW} calls this workflow as a release gate)`)
  })

  it('is a release gate: the release candidate runs it unconditionally, finalize waits for it, and only a successful candidate is promoted', () => {
    expect(releaseGateProblems(read(RC_WORKFLOW))).toEqual([])
    expect(read(RELEASE_WORKFLOW)).toContain('test "$(jq -r .conclusion rc-run.json)" = "success"')
  })

  it('CX8: the release-gate check goes red when the candidate stops waiting for the installer job, drops it or makes it conditional', () => {
    const text = read(RC_WORKFLOW)
    const finalizeNeeds = 'needs: [validate, macos, windows, windows-installer]'
    expect(text.split(finalizeNeeds)).toHaveLength(2)
    expect(releaseGateProblems(text.replace(finalizeNeeds, 'needs: [validate, macos, windows]'))).toContain('finalize does not need windows-installer, so a red installer run would not stop the candidate')
    expect(releaseGateProblems(text.replace(`uses: ${CALLED_AS}`, 'uses: ./.github/workflows/win-gate.yml'))).toContain(`expected one ${RC_WORKFLOW} job calling ${CALLED_AS}, found 0`)
    expect(releaseGateProblems(text.replace(`    uses: ${CALLED_AS}`, `    if: false\n    uses: ${CALLED_AS}`))).toContainEqual(expect.stringMatching(/^the windows-installer job has a condition/))
  })
})

describe('the default project location the runner seeds', () => {
  it('is still the app default: Documents\\Nomi Projects (electron/runtimePaths.ts)', () => {
    const source = read('electron/runtimePaths.ts')
    expect(source).toContain(`return "${DEFAULT_PROJECTS_FOLDER}";`)
    expect(source).toContain('path.join(app.getPath("documents"), defaultProjectsFolderName(appName))')
  })
})

describe('build/installer.nsh', () => {
  const source = read(INSTALLER_NSH)

  it('never removes a directory recursively and defines the six hooks it relies on, once each', () => {
    expect(recursiveRemovals(source)).toEqual([])
    expect(hookCounts(source)).toEqual(Object.fromEntries(HOOKS.map((hook) => [hook, 1])))
  })

  it('CX5: the RMDir check catches a recursive removal however it is written, and ignores comments and strings', () => {
    expect(recursiveRemovals(`${source}\n  RMDir /r "$INSTDIR"\n`)).toHaveLength(1)
    expect(recursiveRemovals(`${source}\n  RMDir /REBOOTOK /r $INSTDIR ; tail comment\n`)).toHaveLength(1)
    expect(recursiveRemovals(`${source}\n  rmdir /R "$INSTDIR\\locales"\n`)).toHaveLength(1)
    expect(recursiveRemovals('; RMDir /r $INSTDIR\n# RMDir /r x\n/* RMDir /r y */\nDetailPrint "RMDir /r is not used"\n')).toEqual([])
    expect(hookCounts(source.replace('!macro customRemoveFiles', '!macro customRemoveFilesOff'))).toMatchObject({ customRemoveFiles: 0 })
  })

  it('uses the same literals as the scenario runner', () => {
    const lines = source.split('\n')
    expect(lines).toContain(`!define NOMI_KEEP_SUFFIX "${KEEP_SUFFIX}"`)
    expect(lines).toContain(`!define NOMI_KEEP_README "${KEEP_README}"`)
    expect(lines).toContain(`!define NOMI_REMOVES_ONLY_OWN_FILES "${MARKER_VALUE_NAME}"`)
    // 待恢复记录的值名：写和删都按槽位拼，读的时候两个槽位各读一次；执行器按同一个前缀造「上次被打断」的现场。
    const pendingNames = new Set(source.match(/"Pending[^"]*"/g))
    expect(pendingNames).toEqual(new Set([`"${PENDING_VALUE_PREFIX}$nomiSlot"`, `"${PENDING_VALUE_PREFIX}1"`, `"${PENDING_VALUE_PREFIX}2"`]))
  })

  it('includes the manifest at the path the generator writes, and only uses macros the generator renders', () => {
    const include = /^!include "\$\{PROJECT_DIR\}\\(.+)"$/m.exec(source)?.[1]
    const generated = path.relative('/project', manifestPaths('/project', '${PRODUCT_FILENAME}', 'x64').nsh).split(path.sep).join(String.fromCharCode(92))
    expect(include).toBe(generated)
    const rendered = renderNsh({ version: '1.0.0', files: ['Nomi.exe'], dirs: ['resources'], topLevelNames: ['Nomi.exe', 'resources'] })
    const used = new Set([...source.matchAll(/\bNOMI_INSTALLER_[A-Z_]+\b/g)].map((match) => match[0]))
    expect([...used].filter((name) => !rendered.includes(`!macro ${name} _M`) && !rendered.includes(`!define ${name} `))).toEqual([])
    expect(used.size).toBeGreaterThanOrEqual(5)
  })

  it('every counterexample changes exactly one place, and CX1 really reintroduces a recursive removal', () => {
    expect(new Set(COUNTEREXAMPLES.map((counterexample) => counterexample.id)).size).toBe(COUNTEREXAMPLES.length)
    for (const counterexample of COUNTEREXAMPLES) {
      expect(SCENARIOS.map((scenario) => scenario.id)).toContain(counterexample.expectRed)
      expect(counterexample.failureMatch.length).toBeGreaterThan(0)
      expect(applyMutation(source, counterexample)).not.toBe(source)
    }
    expect(() => applyMutation(`${source}\n${COUNTEREXAMPLES[0].find}\n`, COUNTEREXAMPLES[0])).toThrow(/exactly one/)
    expect(recursiveRemovals(applyMutation(source, COUNTEREXAMPLES.find((item) => item.card === 'CX1')))).toHaveLength(1)
  })
})

describe('packaging configuration the installer customization depends on', () => {
  const pkg = JSON.parse(read('package.json'))

  it('includes build/installer.nsh into the assisted, per-user-or-machine, x64-only NSIS installer with the afterPack manifest', () => {
    expect(pkg.build.nsis.include).toBe(INSTALLER_NSH)
    expect(pkg.build.nsis.oneClick).toBe(false)
    expect(pkg.build.nsis.perMachine).not.toBe(true)
    expect(pkg.build.nsis.script).toBeUndefined()
    expect(pkg.build.afterPack).toBe('scripts/after-pack-mac.cjs')
    expect(pkg.build.fileAssociations ?? []).toEqual([])
    expect(pkg.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
  })
})

describe('electron-builder NSIS templates', () => {
  it('are byte-for-byte the 26.15.3 files build/installer.nsh was written against', () => {
    expect(fingerprintProblems(templateDir())).toEqual([])
  })

  it('CX6: the fingerprint check catches a one-byte change in any template file', () => {
    const copy = makeTempDir('installer-templates-')
    temps.push(copy)
    fs.cpSync(templateDir(), copy, { recursive: true })
    const target = path.join(copy, 'include', 'installUtil.nsh')
    const bytes = fs.readFileSync(target)
    bytes[bytes.length - 2] ^= 0x01
    fs.writeFileSync(target, bytes)
    expect(fingerprintProblems(copy)).toEqual([expect.stringMatching(/^include\/installUtil\.nsh: [0-9a-f]{64}$/)])
  })
})

registerInstallerCompileTests()
