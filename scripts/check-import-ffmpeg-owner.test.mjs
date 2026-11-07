// ffmpeg / ffprobe 子进程只有一个主人（2026-10-27，方向检查 docs/engineering/direction-checks/2026-10-27-ffmpeg-process-owner.md）。
//
// 主人是 electron/export/mediaProbe.ts 的 runBoundedProcess：AbortSignal、超时、杀整个进程组、删没写完的产物都在那里。
// 各处自己 spawn ffmpeg 的后果见 10-26 走查：导入转码不跟导入同生共死，App 退了还留着 PPID 1、350% CPU 的孤儿。
//
// 本测试扫 electron/ 下全部非测试源码里「直接起 ffmpeg / ffprobe 的子进程」：
//   · 直接起 = child_process 的 spawn / spawnSync / execFile / execFileSync / exec / execSync / fork；
//   · 起的是 ffmpeg / ffprobe = 命令参数里带 ffmpeg / ffprobe 的路径解析或字面量（含同文件里的变量），
//     或者命令是透传进来的参数、而这个文件自己在解析 ffmpeg / ffprobe 路径（透传给本文件私有的 runFfmpeg 一类）。
// 不在冻结基线里的 → 红（改走 runBoundedProcess）；基线里的文件已经不再直接起 → 也红（从基线删掉它，只减不增）。
//
// 车道：scripts/**/*.test.mjs 归默认 vitest 车道（vitest.config.ts 的 VITEST_LANE），`pnpm run gates` 的
// full 档（`pnpm run test`）和 focused 档（test-focused 选中改动文件）都跑；所以这里必须是 vitest 写法——
// 用 node:test 写，vitest 收进来会报「No test suite found」把整条车道打红。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 唯一允许直接起 ffmpeg / ffprobe 的文件：有界运行器本身。 */
export const FFMPEG_PROCESS_OWNER = 'electron/export/mediaProbe.ts'

/**
 * 冻结基线：2026-10-27 还在直接起 ffmpeg / ffprobe 的旧门（导入转码已迁走、不在这里）。只减不增，0.25 分批迁到 runBoundedProcess。
 * 前 8 个是方向检查点名的；后 3 个是这份扫描在同一天的真实源码树上找出来、当时清单漏掉的存量。
 */
export const DIRECT_FFMPEG_LAUNCH_BASELINE = Object.freeze([
  'electron/export/ffmpegRunner.ts',
  'electron/localSpeech/localSpeechTranscribe.ts',
  'electron/review/technicalCheck.ts',
  'electron/video/detectShotCuts.ts',
  'electron/video/extractAudioTrack.ts',
  'electron/video/extractVideoFrame.ts',
  'electron/video/framesToVideo.ts',
  'electron/video/trimVideo.ts',
  'electron/assets/generatedMediaDecode.ts',
  'electron/productionRun/productionRunE2eFixture.ts',
  'electron/video/depthVideoJob.ts',
])

const CHILD_PROCESS_MODULES = new Set(['child_process', 'node:child_process'])
const LAUNCHERS = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'])
const FFMPEG_WORD = /ff(?:mpeg|probe)/i
const FFMPEG_MODULE_OR_BINARY = /^@ff(?:mpeg|probe)-installer\/|^ff(?:mpeg|probe)(?:\.exe)?$/i

function scriptKindOf(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

function isRequireOfChildProcess(node) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === 'require'
    && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])
    && CHILD_PROCESS_MODULES.has(node.arguments[0].text)
}

/** 表达式子树里有没有点名 ffmpeg / ffprobe：标识符、属性名、字符串、模板里的字面量都算。注释不是语法节点，不算。 */
function mentionsFfmpeg(node) {
  let found = false
  const visit = (current) => {
    if (found) return
    if ((ts.isIdentifier(current) || ts.isPrivateIdentifier(current)) && FFMPEG_WORD.test(current.text)) found = true
    else if ((ts.isStringLiteralLike(current) || ts.isTemplateHead(current) || ts.isTemplateMiddle(current) || ts.isTemplateTail(current)) && FFMPEG_WORD.test(current.text)) found = true
    else ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
}

/** 名字是不是包着这次调用的某个函数的参数（命令是透传进来的）。 */
function isEnclosingParameter(name, call) {
  for (let current = call.parent; current; current = current.parent) {
    if (!isFunctionLike(current)) continue
    if (current.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name)) return true
  }
  return false
}

/**
 * 找出一段源码里「直接起 ffmpeg / ffprobe 子进程」的调用。纯函数：喂源码字符串，回 [{ line, launcher, command }]。
 * 只认 child_process 的启动函数（具名导入、命名空间 / 默认导入、require），runBoundedProcess 这类主人 API 不算。
 */
export function findDirectFfmpegLaunches(source, file = 'source.ts') {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file))
  const launcherAliases = new Map()
  const namespaces = new Set()
  const variables = new Map()
  let fileResolvesFfmpeg = false

  const collect = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && CHILD_PROCESS_MODULES.has(node.moduleSpecifier.text)) {
      const clause = node.importClause
      if (clause?.name) namespaces.add(clause.name.text)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text
          if (LAUNCHERS.has(imported)) launcherAliases.set(element.name.text, imported)
        }
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression) && CHILD_PROCESS_MODULES.has(node.moduleReference.expression.text)) {
      namespaces.add(node.name.text)
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (isRequireOfChildProcess(node.initializer)) {
        if (ts.isIdentifier(node.name)) namespaces.add(node.name.text)
        else if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const imported = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : ts.isIdentifier(element.name) ? element.name.text : ''
            if (LAUNCHERS.has(imported) && ts.isIdentifier(element.name)) launcherAliases.set(element.name.text, imported)
          }
        }
      } else if (ts.isIdentifier(node.name) && !variables.has(node.name.text)) {
        variables.set(node.name.text, node.initializer)
      }
    }
    if (ts.isIdentifier(node) && FFMPEG_WORD.test(node.text)) fileResolvesFfmpeg = true
    if (ts.isStringLiteralLike(node) && FFMPEG_MODULE_OR_BINARY.test(node.text)) fileResolvesFfmpeg = true
    ts.forEachChild(node, collect)
  }
  collect(sourceFile)

  const launcherOf = (call) => {
    const callee = call.expression
    if (ts.isIdentifier(callee)) return launcherAliases.get(callee.text) ?? null
    if (ts.isPropertyAccessExpression(callee) && LAUNCHERS.has(callee.name.text)) {
      const target = callee.expression
      if (ts.isIdentifier(target) && namespaces.has(target.text)) return callee.name.text
      if (isRequireOfChildProcess(target)) return callee.name.text
    }
    return null
  }

  const startsFfmpeg = (command, call, seen = new Set()) => {
    if (!command) return false
    if (mentionsFfmpeg(command)) return true
    let expression = command
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression
    if (!ts.isIdentifier(expression)) return false
    const name = expression.text
    if (variables.has(name) && !seen.has(name)) return startsFfmpeg(variables.get(name), call, new Set([...seen, name]))
    // 透传：命令是外层函数的参数，而这个文件自己在解析 ffmpeg / ffprobe 路径——本文件私有的 runFfmpeg 一类。
    return isEnclosingParameter(name, call) && fileResolvesFfmpeg
  }

  const hits = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const launcher = launcherOf(node)
      if (launcher && startsFfmpeg(node.arguments[0], node)) {
        hits.push({
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          launcher,
          command: node.arguments[0].getText(sourceFile),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return hits
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const TEST_FILE = /\.(?:test|spec|node-test)\.[cm]?[jt]sx?$/

/** electron/ 下全部非测试源码（相对仓库根、正斜杠）。走磁盘不走 git：还没提交的新文件同样要被扫到。 */
export function electronSourceFiles(root = repoRoot) {
  const out = []
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        walk(child)
      } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(child)
      }
    }
  }
  walk('electron')
  return out.sort()
}

describe('findDirectFfmpegLaunches — 字符串样例', () => {
  const hitsOf = (source, file) => findDirectFfmpegLaunches(source, file).map(({ launcher, command }) => `${launcher}(${command})`)

  it('反例：新写一段 spawn(resolveFfmpegPath(), …) 必须被抓到', () => {
    const source = [
      'import { spawn } from "node:child_process";',
      'import { resolveFfmpegPath } from "../export/ffmpegRunner";',
      'export function extractThing(args: string[]) {',
      '  return spawn(resolveFfmpegPath(), ["-hide_banner", ...args], { windowsHide: true });',
      '}',
    ].join('\n')
    expect(findDirectFfmpegLaunches(source, 'electron/video/newThing.ts')).toEqual([
      { line: 4, launcher: 'spawn', command: 'resolveFfmpegPath()' },
    ])
  })

  it('各种起法：别名导入 / 命名空间 / 默认导入 / require / 字面量 / 同文件变量 / 透传参数', () => {
    expect(hitsOf('import { execFile as run } from "child_process";\nrun("ffprobe", ["-v", "error"]);')).toEqual(['execFile("ffprobe")'])
    expect(hitsOf('import * as cp from "node:child_process";\ncp.spawnSync(ffmpegPath, args);')).toEqual(['spawnSync(ffmpegPath)'])
    expect(hitsOf('import childProcess from "node:child_process";\nchildProcess.exec(`ffmpeg -i ${input} out.mp4`);')).toEqual(['exec(`ffmpeg -i ${input} out.mp4`)'])
    expect(hitsOf('const { spawnSync } = require("child_process");\nspawnSync(require("@ffmpeg-installer/ffmpeg").path, []);', 'x.cjs'))
      .toEqual(['spawnSync(require("@ffmpeg-installer/ffmpeg").path)'])
    expect(hitsOf('require("node:child_process").fork(ffprobeBin, []);', 'x.cjs')).toEqual(['fork(ffprobeBin)'])
    expect(hitsOf('import { spawn } from "node:child_process";\nconst bin = resolveFfmpegPath();\nspawn(bin, []);')).toEqual(['spawn(bin)'])
    expect(hitsOf([
      'import { spawn } from "node:child_process";',
      'import { resolveFfprobePath } from "../export/mediaProbe";',
      'function runProcess(binary: string, args: string[]) { return spawn(binary, args); }',
      'runProcess(resolveFfprobePath(), ["-show_streams"]);',
    ].join('\n'))).toEqual(['spawn(binary)'])
  })

  it('不算：别的程序、文件里没有 ffmpeg 的透传、注释、字符串里的样子、主人 API、同名的本地函数', () => {
    expect(hitsOf('import { spawn } from "node:child_process";\nspawn("tar", ["-xf", archive]);')).toEqual([])
    expect(hitsOf('import { spawn } from "node:child_process";\nexport function play(command: string, args: string[]) { return spawn(command, args); }')).toEqual([])
    expect(hitsOf('import { spawn } from "node:child_process";\n// spawn(resolveFfmpegPath(), args)\n/* execFile("ffprobe") */')).toEqual([])
    expect(hitsOf('const example = "spawn(resolveFfmpegPath(), args)";\nconst template = `execFile(ffprobe)`;')).toEqual([])
    expect(hitsOf('import { runBoundedProcess } from "../export/mediaProbe";\nawait runBoundedProcess(resolveFfmpegPath(), args, options);')).toEqual([])
    expect(hitsOf('function spawn(command: string) { return command; }\nspawn(ffmpegPath);')).toEqual([])
  })
})

describe('真实源码树：ffmpeg / ffprobe 只经有界运行器起，旧门只减不增', () => {
  const found = new Map()
  for (const file of electronSourceFiles()) {
    const hits = findDirectFfmpegLaunches(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file)
    if (hits.length > 0) found.set(file, hits)
  }

  it('不在基线里的文件没有直接起 ffmpeg / ffprobe（新代码改走 runBoundedProcess）', () => {
    const baseline = new Set([FFMPEG_PROCESS_OWNER, ...DIRECT_FFMPEG_LAUNCH_BASELINE])
    const added = [...found].filter(([file]) => !baseline.has(file))
      .flatMap(([file, hits]) => hits.map((hit) => `${file}:${hit.line} ${hit.launcher}(${hit.command})`))
    expect(added, '新增直接起 ffmpeg / ffprobe 的子进程：改走 electron/export/mediaProbe.ts 的 runBoundedProcess（带 signal / 超时 / 杀进程组）').toEqual([])
  })

  it('基线里的文件都还在直接起；不再起的要从基线删掉（只减不增）', () => {
    const stale = DIRECT_FFMPEG_LAUNCH_BASELINE.filter((file) => !found.has(file))
    expect(stale, '这些文件已经不再直接起 ffmpeg / ffprobe：从 DIRECT_FFMPEG_LAUNCH_BASELINE 删掉它').toEqual([])
  })

  it('导入转码不在基线里，而且把信号交给有界运行器', () => {
    expect(DIRECT_FFMPEG_LAUNCH_BASELINE).not.toContain('electron/assets/videoImportNormalize.ts')
    const normalizer = fs.readFileSync(path.join(repoRoot, 'electron/assets/videoImportNormalize.ts'), 'utf8')
    expect(found.has('electron/assets/videoImportNormalize.ts')).toBe(false)
    // 信号 = 调用方的请求信号 + 退出排空的停止信号；行为由 importTranscodeLifecycle.integration.test.ts 按进程查。
    const boundedCall = normalizer.slice(normalizer.indexOf('runBoundedProcess('))
    expect(boundedCall.slice(0, boundedCall.indexOf('});'))).toMatch(/\bsignal\b/)
  })
})
