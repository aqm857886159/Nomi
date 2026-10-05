import { describe, expect, it } from 'vitest'
import { formatAgentContextSnapshot } from '../../../../../../electron/shared/agentContextSnapshot'
import { buildResidentContextSnapshot, mergeResidentContextHandles } from '../../../../ai/resident/residentContextSnapshot'
import { directorShotContextHandles, directorShotFocusFrom, shotIdOfCamera } from './directorShotFocus'

const cut = (cameraId: string, start: number) => ({ start, end: start + 3, cameraId, shotSize: '中景' as const, move: 'static', actions: [] })
const base = { directorNodeId: 'node-box', revision: 'dplan-abc', planShotIds: ['wide', 'close'], cuts: [cut('shot:wide/camera', 0), cut('shot:close/camera', 3)] }

describe('镜头焦点（正在改：镜头 N 的数据）', () => {
  it('选中计划镜头的机位 → 镜头名 + 镜头条序号；用户自建机位 / 没选 / 没有计划 → 不带', () => {
    expect(shotIdOfCamera('shot:close/camera')).toBe('close')
    expect(directorShotFocusFrom({ ...base, selectedCameraIds: ['shot:close/camera'] })).toEqual({ directorNodeId: 'node-box', revision: 'dplan-abc', shots: [{ shotId: 'close', index: 2, measured: cut('shot:close/camera', 3) }] })
    expect(directorShotFocusFrom({ ...base, selectedCameraIds: ['camera-user-1'] })).toBeNull()
    expect(directorShotFocusFrom({ ...base, selectedCameraIds: [null] })).toBeNull()
    expect(directorShotFocusFrom({ ...base, revision: null, selectedCameraIds: ['shot:close/camera'] })).toBeNull()
    expect(directorShotFocusFrom({ ...base, selectedCameraIds: ['shot:gone/camera'] })).toBeNull()
  })

  it('多选按镜头条顺序、去重；没进切点的退到计划顺序', () => {
    const focus = directorShotFocusFrom({ ...base, cuts: [cut('shot:wide/camera', 0)], selectedCameraIds: ['shot:close/camera', 'shot:wide/camera', 'shot:close/camera'] })
    expect(focus?.shots.map((shot) => [shot.shotId, shot.index, shot.measured !== null])).toEqual([['wide', 1, true], ['close', 2, false]])
  })

  it('进模型的那段上下文里有导演节点、修订号和镜头名（补丁要用的三样），且和画布选中合在同一份快照', () => {
    const handles = directorShotContextHandles(directorShotFocusFrom({ ...base, selectedCameraIds: ['shot:close/camera'] }), (index) => `镜头 ${index}`, '3D-BOX 预演')
    const snapshot = mergeResidentContextHandles(buildResidentContextSnapshot({ canvas: { revision: 7, nodes: [{ id: 'node-box', title: '预演' }], selectedNodeIds: ['node-box'] } }), handles)
    expect(snapshot.handles.map((handle) => handle.id)).toEqual(['canvas-node:node-box', 'director-shot:node-box/close'])
    const text = formatAgentContextSnapshot(snapshot)
    expect(text).toContain('"targetId":"node-box"')
    expect(text).toContain('"revision":"dplan-abc"')
    expect(text).toContain('"key":"director.shot","value":"close"')
    expect(text).toContain('镜头 2')
    expect(directorShotContextHandles(null, String, '')).toEqual([])
  })
})
