import { describe, expect, it } from 'vitest'
import { parseDirectorPlan, type DirectorPlan } from '../../../../../../electron/shared/director/directorPlanSchema'
import { applyDirectorPlanEdits, type DirectorPlanEdit } from '../../../../../../electron/shared/director/planPatch'
import { compileDirectorPlan } from './compiler/directorPlanCompiler'
import { createDirectorStore } from './directorStore'
import { normalizeDirectorProject } from './directorProject'
import type { DirectorProject } from './directorTypes'
import { deriveDirectorOverrides, fingerprintDirectorProject, overlayDirectorProject } from './planOverrides'

/** 题库外：女孩在院子里拿着信（信 on 女孩 → 编译器把两人挂进携带分组 carry:actor:girl）。 */
function plan(withLetter: boolean): DirectorPlan {
  const parsed = parseDirectorPlan({
    scene: { environment: 'day', template: 'courtyard', tags: ['院子'] },
    actors: [
      { id: 'girl', kind: 'person', desc: '女孩', placement: { relation: 'at', ref: 's1-courtyard-ground' } },
      ...(withLetter ? [{ id: 'letter', kind: 'prop', desc: '信', placement: { relation: 'on', ref: 'girl' } }] : []),
    ],
    shots: [{ id: 'wide', window: [0, 4], transitionIn: 'cut', subject: 'girl', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } }],
  })
  if (!parsed.success) throw new Error(parsed.error.message)
  return JSON.parse(JSON.stringify(parsed.data)) as DirectorPlan
}

function compiled(input: DirectorPlan): DirectorProject {
  const result = compileDirectorPlan(input)
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.project
}

function patch(base: DirectorPlan, edits: DirectorPlanEdit[]) {
  const result = applyDirectorPlanEdits(base, edits)
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result
}

const object = (project: DirectorProject, id: string) => normalizeDirectorProject(project).scenes[0].objects.find((item) => item.id === id)

describe('planOverrides', () => {
  it('编辑器往返（加载 → 导出）不产生假手改', () => {
    const project = compiled(plan(true))
    const roundTrip = createDirectorStore({ rawProject: JSON.parse(JSON.stringify(project)), defaultSceneName: 'S' }).getState().exportProject()
    expect(deriveDirectorOverrides(fingerprintDirectorProject(project), roundTrip)).toEqual([])
  })

  it('用户新加的实体、删掉的实体、自建图层与出片记录都跟着走', () => {
    const before = plan(false)
    const base = compiled(before)
    const current = normalizeDirectorProject(base)
    current.scenes[0].objects.push({ id: 'user-lamp', name: '台灯', type: 'cube', position: { x: 1, y: 0, z: 1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false })
    const tree = current.scenes[0].objects.findIndex((item) => item.id === 's1-courtyard-tree')
    expect(tree).toBeGreaterThanOrEqual(0)
    current.scenes[0].objects.splice(tree, 1)
    current.scenes.push({ ...current.scenes[0], id: 'user-layer', name: '我的图层', objects: [], cameras: [], lights: [] })
    current.outputs.videos.push({ id: 'v1', name: '预演', assetUrl: 'nomi-local://asset/p/v1.mp4', width: 1280, height: 720, duration: 4, createdAt: 1 })
    const next = patch(before, [{ op: 'replace', path: '/shots/wide/size', value: '中景' }])
    const result = overlayDirectorProject({ compiled: compiled(next.plan), current, base: fingerprintDirectorProject(base), touched: next.touched })
    expect(object(result.project, 'user-lamp')?.name).toBe('台灯')
    expect(object(result.project, 's1-courtyard-tree')).toBeUndefined()
    expect(result.project.scenes.map((scene) => scene.id)).toEqual(['scene:director', 'user-layer'])
    expect(result.project.outputs.videos.map((video) => video.id)).toEqual(['v1'])
    expect(result.reorderedOverrides).toEqual([])
  })

  it('补丁让人从「拿着东西」变成「空手」：分组上的走位手改转写到人身上；人在分组里的局部偏移无法等价，丢弃并列出', () => {
    const before = plan(true)
    const base = compiled(before)
    expect(object(base, 'actor:girl')?.parentId).toBe('carry:actor:girl')
    const current = normalizeDirectorProject(base)
    const group = current.scenes[0].objects.find((item) => item.id === 'carry:actor:girl')!
    group.position = { ...group.position, x: group.position.x + 1.5 }
    const girl = current.scenes[0].objects.find((item) => item.id === 'actor:girl')!
    girl.position = { ...girl.position, z: 0.4 }
    const next = patch(before, [{ op: 'remove', path: '/actors/letter' }])
    const result = overlayDirectorProject({ compiled: compiled(next.plan), current, base: fingerprintDirectorProject(base), touched: next.touched })
    expect(object(result.project, 'carry:actor:girl')).toBeUndefined()
    expect(object(result.project, 'actor:girl')?.position.x).toBeCloseTo(group.position.x, 6)
    expect(result.reorderedOverrides).toContain('actor:girl.position')
  })

  it('补丁让空手的人拿起东西：人身上的走位手改转写到新的携带分组', () => {
    const before = plan(false)
    const base = compiled(before)
    const current = normalizeDirectorProject(base)
    const girl = current.scenes[0].objects.find((item) => item.id === 'actor:girl')!
    girl.position = { ...girl.position, x: girl.position.x - 2 }
    const next = patch(before, [{ op: 'add', path: '/actors/letter', value: { kind: 'prop', desc: '信', placement: { relation: 'on', ref: 'girl' } } }])
    const result = overlayDirectorProject({ compiled: compiled(next.plan), current, base: fingerprintDirectorProject(base), touched: next.touched })
    expect(object(result.project, 'carry:actor:girl')?.position.x).toBeCloseTo(girl.position.x, 6)
    expect(object(result.project, 'actor:girl')?.parentId).toBe('carry:actor:girl')
    expect(result.reorderedOverrides).toEqual([])
  })

  it('直接改到角色：它和它的携带分组都算直接改到；新编译没改到的属性手改照留', () => {
    const before = plan(true)
    const base = compiled(before)
    const current = normalizeDirectorProject(base)
    current.scenes[0].objects.find((item) => item.id === 'actor:girl')!.color = '#ff0000'
    const next = patch(before, [{ op: 'replace', path: '/actors/girl/desc', value: '小女孩' }])
    const result = overlayDirectorProject({ compiled: compiled(next.plan), current, base: fingerprintDirectorProject(base), touched: next.touched })
    expect(object(result.project, 'actor:girl')?.color).toBe('#ff0000')
    expect(object(result.project, 'actor:girl')?.name).toBe('小女孩')
    expect(result.changedEntities).not.toContain('actor:girl')
    expect(result.changedEntities).not.toContain('carry:actor:girl')
  })
})
