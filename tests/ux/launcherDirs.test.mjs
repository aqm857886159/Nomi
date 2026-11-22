// 走查启动器「手传目录」冻结名单的静态对账（D-test-world-owner-only 批 1）。
// 运行时的闸在 launchNomiApp（名单外传 settingsDir / projectsDir → launch_option_removed）；走查不在 CI 里跑，
// 所以这里再钉两件事：① 名单只许减（列着但已不再提这两个名字的文件，红，提示删行）；
// ② 新文件不能在 launchNomiApp( … ) 的参数里直接写这两个键（红，提示改传 world）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launchNomiApp } from './_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const list = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/ux/not-yet-migrated/launcherDirs.json'), 'utf8')).files

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(mjs|cjs|js|ts)$/.test(entry.name)) out.push(path.relative(repoRoot, full).split(path.sep).join('/'))
  }
  return out
}

/** `launchNomiApp(` 之后配平括号取出参数文本。 */
function launchCallArguments(source) {
  const calls = []
  for (const match of source.matchAll(/launchNomiApp\(/g)) {
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') depth -= 1
    }
    calls.push(source.slice(start, i - 1))
  }
  return calls
}

const KEY = /(^|[\s{,])(settingsDir|projectsDir)\s*[:,}\n]/

describe('走查启动器手传目录：冻结名单', () => {
  it('名单里的文件都在，且仍然提 settingsDir / projectsDir（不再提了就从名单删）', () => {
    expect([...list]).toEqual([...new Set(list)].sort())
    for (const rel of list) {
      const file = path.join(repoRoot, rel)
      expect(fs.existsSync(file), `${rel} 不存在，从 launcherDirs.json 删掉这一行`).toBe(true)
      expect(/\b(settingsDir|projectsDir)\b/.test(fs.readFileSync(file, 'utf8')), `${rel} 已不再提 settingsDir/projectsDir：从 launcherDirs.json 删掉这一行`).toBe(true)
    }
  })

  it('名单外的文件，不在 launchNomiApp(…) 的参数里直接写 settingsDir / projectsDir', () => {
    const listed = new Set(list)
    const offenders = []
    for (const root of ['tests', 'scripts', 'evals']) {
      for (const rel of walk(path.join(repoRoot, root), [])) {
        if (listed.has(rel) || rel === 'tests/ux/_launchApp.mjs' || rel.startsWith('tests/world/') || rel === 'tests/ux/launcherDirs.test.mjs') continue
        const source = fs.readFileSync(path.join(repoRoot, rel), 'utf8')
        if (!source.includes('launchNomiApp(')) continue
        if (launchCallArguments(source).some((text) => KEY.test(text))) offenders.push(rel)
      }
    }
    expect(offenders, 'launch_option_removed：这些文件传了已删的 settingsDir / projectsDir，改传 world: buildWorld(spec)').toEqual([])
  })

  it('运行时：名单外调用传 settingsDir → launch_option_removed；世界句柄不是发的 → launch_world_not_issued', async () => {
    await expect(launchNomiApp({ settingsDir: '/tmp/x' })).rejects.toThrow(/launch_option_removed: settingsDir \/ projectsDir 已删/)
    await expect(launchNomiApp({ world: { rootDir: '/tmp/x', settingsDir: '/tmp/x/s', projectsDir: '/tmp/x/p', userDataDir: '/tmp/x/u' } })).rejects.toThrow(/launch_world_not_issued/)
  })

  // 走查跑在纯 node：_world.mjs 用 tsx 的 CJS 加载 tests/world/index.ts，启动器用 ESM 引 issued.mjs——同一个文件被加载两份
  // （Node 文档的「双包隐患」），模块里的登记表若各管各的，buildWorld 发的世界在启动器那边就是「没发过」。
  // vitest 里两边走同一套模块图，看不出来，所以起一个纯 node 子进程，按走查的真实路径判。
  it('纯 node 走查里：_world.mjs 发的世界，启动器引的 issued.mjs 认得', () => {
    const script = [
      `const { buildWorld } = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, 'tests/ux/_world.mjs')).href)})`,
      `const { isIssuedWorld } = await import(${JSON.stringify(pathToFileURL(path.join(repoRoot, 'tests/world/issued.mjs')).href)})`,
      `const world = buildWorld({ builtinSeeds: false, projects: [] })`,
      `try { process.stdout.write(JSON.stringify({ issued: isIssuedWorld(world) })) } finally { world.cleanup() }`,
    ].join('\n')
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 })
    expect(JSON.parse(out), 'launch_world_not_issued 会挡住每一条传 world 的走查：登记表要在进程里只有一份').toEqual({ issued: true })
  }, 90_000)
})
