// 走查启动器「手传目录」冻结名单的静态对账（D-test-world-owner-only 批 1）。
// 运行时的闸在 launchNomiApp（名单外传 settingsDir / projectsDir → launch_option_removed）；走查不在 CI 里跑，
// 所以这里再钉两件事：① 名单只许减（列着但已不再提这两个名字的文件，红，提示删行）；
// ② 新文件不能在 launchNomiApp( … ) 的参数里直接写这两个键（红，提示改传 world）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
})
