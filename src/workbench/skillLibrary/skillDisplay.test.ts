import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SkillListItemDto } from '../api/skillApi'
import { STORYBOARD_PLANNER_SKILL } from '../generationCanvas/agent/storyboardLauncher'
import { findSkillRecord } from '../../../electron/shared/skillKey'
import { skillForKey, skillLabelForKey } from './skillDisplay'

// 2026-11-08：选中一句点「拆成镜头」，分镜启动器发的是点号 key `workbench.storyboard.planner`；
// 主进程按归一认出了技能、照常注入，界面按 `name` 精确查没认出来，气泡小签和「已载入技能：」都印了 key。
// 合同：key → 技能只有一处查找（`electron/shared/skillKey.ts`），界面和主进程认同一批 key。

/** 真目录的形状：SKILL.md 的 `name` 与目录名同值（短横线），名字在 library.title（这里从真 SKILL.md 读）。 */
function plannerFromDisk(): SkillListItemDto {
  const source = readFileSync(resolve(process.cwd(), 'skills/workbench-storyboard-planner/SKILL.md'), 'utf8')
  const title = /\n\s+title:\s*\n\s+zh-CN:\s*(.+)\n\s+en:\s*(.+)\n/.exec(source)
  const name = /^name:\s*(.+)$/m.exec(source)?.[1].trim()
  if (!title || !name) throw new Error('读不到分镜规划技能的 name / library.title')
  return {
    name,
    directoryName: name,
    label: name,
    curation: { title: { 'zh-CN': title[1].trim(), en: title[2].trim() } } as SkillListItemDto['curation'],
    description: null,
    author: null,
    stageLabels: [],
    isPlaybook: false,
    neededProviders: [],
    manifestError: null,
    origin: 'builtin',
    packageVersion: '1',
    contentHash: 'hash',
  }
}

describe('技能 key → 界面上的名字', () => {
  const planner = plannerFromDisk()
  const skills = [planner]

  it('用户那次：分镜启动器发的点号 key 印「分镜规划」/ 英文对应名，不印 key', () => {
    expect(STORYBOARD_PLANNER_SKILL.key).toContain('.')
    expect(skillLabelForKey(skills, STORYBOARD_PLANNER_SKILL.key, 'zh-CN')).toBe('分镜规划')
    expect(skillLabelForKey(skills, STORYBOARD_PLANNER_SKILL.key, 'en')).toBe('Storyboard planning')
  })

  it('点号 key 和短横线 key 指同一个技能、同一个名字', () => {
    for (const key of ['workbench.storyboard.planner', 'workbench-storyboard-planner']) {
      expect(skillForKey(skills, key), key).toBe(planner)
      expect(skillLabelForKey(skills, key, 'zh-CN'), key).toBe('分镜规划')
    }
  })

  it('这台机器上没有的技能照实印 key（不藏掉用户做过的操作）', () => {
    expect(skillForKey(skills, 'nobody.has.this')).toBeNull()
    expect(skillLabelForKey(skills, 'nobody.has.this', 'zh-CN')).toBe('nobody.has.this')
  })

  it('界面认的技能和主进程认的是同一个（同一份查找，不是两份对齐）', () => {
    const keys = ['workbench.storyboard.planner', 'workbench-storyboard-planner', 'workbench_storyboard_planner', 'workbenchStoryboardPlanner', 'nobody.has.this']
    for (const key of keys) expect(skillForKey(skills, key), key).toBe(findSkillRecord(key, '', skills))
  })
})

describe('渲染层没有第二份「key → 技能」查找（结构）', () => {
  const root = resolve(process.cwd(), 'src')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full)
    }
  }
  walk(root)
  // `skills.find((skill) => skill.name === key)` 这一族：在技能列表上按 name / 目录名自己比。
  const OWN_LOOKUP = /\bskills?\w*\s*\.\s*(?:find|filter|some|findIndex)\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\s*\.\s*(?:name|directoryName)\s*===/i

  it('src 里按 key 找技能只走 skillForKey / skillLabelForKey', () => {
    const offenders = files
      .filter((file) => OWN_LOOKUP.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')))
      .map((file) => relative(process.cwd(), file))
    expect(offenders).toEqual([])
  })

  it('探针是活的：旧写法会被它认出来', () => {
    expect(OWN_LOOKUP.test('const found = skills.find((skill) => skill.name === key)')).toBe(true)
    expect(OWN_LOOKUP.test('const skill = skills.find(s => s.name === activeSkill.key)')).toBe(true)
  })
})
