import { describe, expect, it } from 'vitest'
import { cloneDirectorProject, createDefaultProject, normalizeDirectorProject, projectStats } from './directorProject'

describe('directorProject', () => {
  it('default project has one visible scene with the documented defaults', () => {
    const project = createDefaultProject('场景 1')
    expect(project.scenes).toHaveLength(1)
    expect(project.activeSceneId).toBe(project.scenes[0].id)
    expect(project.scenes[0].sceneConfig).toMatchObject({ gridVisible: true, groundOpacity: 0.2, showRuleOfThirds: true, modelDisplayMode: 'solid' })
    expect(project.scenes[0].panoramaConfig.radius).toBe(500)
    expect(project.exportRatio).toBe('16:9')
  })

  it('normalizes garbage into a valid project instead of throwing', () => {
    expect(normalizeDirectorProject(undefined).scenes).toHaveLength(1)
    expect(normalizeDirectorProject('nope').scenes).toHaveLength(1)
    const project = normalizeDirectorProject({
      activeSceneId: 'missing',
      exportRatio: '7:1',
      scenes: [
        {
          id: 's1',
          objects: [
            { id: 'o1', type: 'character', position: { x: 1 }, parentId: 'ghost', trajectoryClips: [{ id: 't', startTime: 2, endTime: 1 }] },
            { id: 'bad-type', type: 'teapot' },
            'not-an-object',
          ],
          cameras: [{ id: 'c1', fov: 35, closeupClips: [{ id: 'k', startTime: 0, endTime: 2, anchor: 'nose', motionPreset: 'warp' }] }],
          lights: [{ id: 'l1', type: 'spot' }],
          timelineTrackOrder: ['c1', 'ghost'],
        },
      ],
      outputs: { screenshots: [{ id: 'x', assetUrl: 'nomi-local://a.png' }, { id: 'no-url' }] },
    })
    expect(project.activeSceneId).toBe('s1')
    expect(project.exportRatio).toBe('16:9')
    const scene = project.scenes[0]
    expect(scene.objects.map((object) => object.type)).toEqual(['character', 'cube'])
    expect(scene.objects[0].position).toEqual({ x: 1, y: 0, z: 0 })
    expect(scene.objects[0].parentId).toBeUndefined()
    expect(scene.objects[0].trajectoryClips).toBeUndefined()
    expect(scene.cameras[0].focalLengthMm).toBeCloseTo(38.1, 0)
    expect(scene.cameras[0].closeupClips?.[0]).toMatchObject({ anchor: 'face', motionPreset: 'static', distance: 1.2 })
    expect(scene.lights[0]).toMatchObject({ type: 'spot', spotAngle: 45, spotPenumbra: 0.3 })
    expect(scene.timelineTrackOrder).toEqual(['c1'])
    expect(project.outputs.screenshots).toHaveLength(1)
  })

  it('clone is deep and stats count across scenes', () => {
    const project = createDefaultProject('a')
    project.scenes[0].objects.push({
      id: 'o', name: 'o', type: 'cube', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false,
    })
    const copy = cloneDirectorProject(project)
    copy.scenes[0].objects[0].name = 'changed'
    expect(project.scenes[0].objects[0].name).toBe('o')
    expect(projectStats(project)).toEqual({ objectCount: 1, cameraCount: 0, hasPanorama: false })
  })
})
