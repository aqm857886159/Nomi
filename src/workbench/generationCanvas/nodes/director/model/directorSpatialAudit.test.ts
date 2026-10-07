import { describe, expect, it } from 'vitest'
import { auditDirectorSpace, type SpatialAuditContext } from './directorSpatialAudit'
import { createDefaultProject } from './directorProject'
import { originYForBottom } from './directorSpace'
import type { DirectorCamera, DirectorObject, DirectorProject } from './directorTypes'

const v = (x = 0, y = 0, z = 0) => ({ x, y, z })
const cube = (id: string, position: ReturnType<typeof v>, scale = v(1, 1, 1), extra: Partial<DirectorObject> = {}): DirectorObject => ({
  id, name: id, type: 'cube', position, rotation: v(), scale, visible: true, locked: false, ...extra,
})
const floor = cube('floor', v(0, originYForBottom({ type: 'cube', scale: v(10, 0.05, 10) }, -0.05), 0), v(10, 0.05, 10))
function project(objects: DirectorObject[], cameras: DirectorCamera[] = []): DirectorProject {
  const p = createDefaultProject('audit')
  p.scenes[0].objects = objects
  p.scenes[0].cameras = cameras
  return p
}
const criteria = (p: DirectorProject, context?: SpatialAuditContext) => auditDirectorSpace(p, context).map((item) => item.criterion)

describe('directorSpatialAudit 六条物理判据', () => {
  it('干净的场景：站在地面上、互不相交 → 没有违例', () => {
    expect(criteria(project([floor, cube('actor:a', v(-2, 0, 0)), cube('actor:b', v(2, 0, 0))]))).toEqual([])
  })

  it('悬空：底离地 0.5m 又没被托住 → floating；叠在另一件顶上不算', () => {
    expect(criteria(project([floor, cube('crate', v(0, 0.5, 0))]))).toContain('floating')
    expect(criteria(project([floor, cube('crate', v(0, 0, 0)), cube('actor:cap', v(0, 1, 0), v(0.3, 0.3, 0.3))]))).not.toContain('floating')
  })

  it('互穿：两个放进来的件重叠 → interpenetrating；携带物除外', () => {
    const objects = [floor, cube('actor:a', v(0, 0, 0)), cube('actor:b', v(0.3, 0, 0))]
    expect(criteria(project(objects))).toContain('interpenetrating')
    expect(criteria(project(objects), { shots: [], carried: [['actor:b', 'actor:a']] })).not.toContain('interpenetrating')
  })

  it('地面只有一个高度：陷进地面板 → offFloor', () => {
    expect(criteria(project([floor, cube('actor:a', v(0, -0.2, 0))]))).toContain('offFloor')
  })

  it('机位在物体里 → cameraInside', () => {
    const camera = { id: 'cam', name: 'cam', position: v(0, 0.5, 0), yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 35, motionTrajectory: [], trajectoryClips: [{ id: 'c', startTime: 0, endTime: 1, startFrame: 0, endFrame: 30 }] } as DirectorCamera
    expect(criteria(project([floor, cube('wall', v(0, 0, 0), v(2, 2, 2))], [camera]))).toContain('cameraInside')
  })

  it('看不见主体：视线被墙挡住 → occluded（需要计划上下文）', () => {
    const camera = { id: 'cam', name: 'cam', position: v(0, 1, 5), yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 35, motionTrajectory: [], trajectoryClips: [{ id: 'c', startTime: 0, endTime: 1, startFrame: 0, endFrame: 30 }] } as DirectorCamera
    const objects = [floor, cube('actor:a', v(0, 0, -3)), cube('wall', v(0, 0, 0), v(4, 3, 0.2))]
    const context: SpatialAuditContext = { shots: [{ cameraId: 'cam', subjectId: 'actor:a', window: [0, 1] }], carried: [] }
    expect(criteria(project(objects, [camera]), context)).toContain('occluded')
    expect(criteria(project(objects, [camera]))).not.toContain('occluded')
  })

  it('携带物没跟着持有者走 → carriedDrift；挂了父级就跟得上', () => {
    const walk = { motionTrajectory: [{ id: 'w0', ...v(0, 0, 0), yaw: 0, pitch: 0, roll: 0, time: 0, frameIndex: 0, clipId: 'k' }, { id: 'w1', ...v(4, 0, 0), yaw: 0, pitch: 0, roll: 0, time: 2, frameIndex: 60, clipId: 'k' }], trajectoryClips: [{ id: 'k', startTime: 0, endTime: 2, startFrame: 0, endFrame: 60 }] }
    const holder = cube('actor:woman', v(0, 0, 0), v(0.6, 1.75, 0.4), walk)
    const context: SpatialAuditContext = { shots: [], carried: [['actor:letter', 'actor:woman']] }
    expect(criteria(project([floor, holder, cube('actor:letter', v(0.3, 0, 0.3), v(0.2, 0.1, 0.2))]), context)).toContain('carriedDrift')
    expect(criteria(project([floor, holder, cube('actor:letter', v(0.3, 0, 0.3), v(0.2, 0.1, 0.2), { parentId: 'actor:woman' })]), context)).not.toContain('carriedDrift')
  })
})
