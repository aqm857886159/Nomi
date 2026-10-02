import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './directorProject'
import {
  applyDirectorPrompt,
  buildDirectorProjectFromPlan,
  compileDirectorCameraTrack,
  editDirectorPlan,
  normalizeDirectorPrompt,
  parseDirectorRuntimePlan,
  stableDirectorId,
} from './directorPlan'

describe('directorPlan P0', () => {
  it('parses the existing Lane director Skill envelope', () => {
    expect(parseDirectorRuntimePlan('```json\n{"prompt":"Shot 1: orbit around the character for 2s"}\n```')).toEqual({
      prompt: 'Shot 1: orbit around the character for 2s',
    })
    expect(parseDirectorRuntimePlan('not json')).toBeNull()
  })
  it('normalizes one to three shots and gives stable ids', () => {
    const prompt = 'Shot 1: a character pushes in for 2s. Shot 2: orbit around the character for 3s.'
    const first = normalizeDirectorPrompt(prompt)
    const second = normalizeDirectorPrompt(prompt)
    expect(first.shots).toHaveLength(2)
    expect(first.shots.map((shot) => shot.id)).toEqual(second.shots.map((shot) => shot.id))
    expect(first.scene.entities[0].id).toBe(second.scene.entities[0].id)
    expect(first.shots[0].motions[0]).toMatchObject({ kind: 'push', duration: 2, easing: 'ease_in_out' })
    expect(first.shots[1].motions[0]).toMatchObject({ kind: 'orbit', duration: 3 })
    expect(stableDirectorId('shot', 'same')).toBe(stableDirectorId('shot', 'same'))
  })

  it('compiles semantic camera moves into editable clip waypoints with lookAt ids', () => {
    const plan = normalizeDirectorPrompt('Shot 1: follow the character, then pan for 2s')
    const track = compileDirectorCameraTrack(plan)
    expect(track.issues).toEqual([])
    expect(track.clips).toHaveLength(1)
    expect(track.waypoints.length).toBeGreaterThanOrEqual(2)
    expect(track.waypoints.every((point) => point.clipId === track.clips[0].id)).toBe(true)
    expect(track.waypoints[0].lookAtObjectId).toBe(plan.scene.entities[0].id)
    expect(track.waypoints.at(-1)?.easing).toBe('ease_in_out')
    expect(track.waypoints.at(-1)?.time).toBe(track.clips[0].endTime)
  })

  it.each([
    ['push in', 'push'],
    ['pull out', 'pull'],
    ['pan left', 'pan'],
    ['tilt up', 'tilt'],
    ['orbit around the character', 'orbit'],
    ['follow the character', 'follow'],
    ['switch to the character', 'target_switch'],
  ] as const)('normalizes %s as a typed camera action', (phrase, kind) => {
    const plan = normalizeDirectorPrompt(`A character ${phrase} for 1s`)
    expect(plan.shots[0].motions[0].kind).toBe(kind)
    expect(plan.shots[0].motions[0].lookAt).toMatchObject({ type: 'entity', entityId: plan.scene.entities[0].id })
  })

  it('keeps directional pan and tilt intent in the typed amount', () => {
    expect(normalizeDirectorPrompt('A character pans left for 1s').shots[0].motions[0].amount).toBeLessThan(0)
    expect(normalizeDirectorPrompt('A character tilts down for 1s').shots[0].motions[0].amount).toBeLessThan(0)
  })

  it('keeps shot identity and target while applying a local second-shot edit', () => {
    const plan = normalizeDirectorPrompt('Shot 1: push in for 2s. Shot 2: pan right for 2s')
    const edited = editDirectorPlan(plan, 'second shot slower and keep the target centered')!
    expect(edited.shots.map((shot) => shot.id)).toEqual(plan.shots.map((shot) => shot.id))
    expect(edited.shots[0].duration).toBe(plan.shots[0].duration)
    expect(edited.shots[1].duration).toBeGreaterThan(plan.shots[1].duration)
    expect(edited.shots[1].motions.every((motion) => motion.lookAt?.type === 'entity')).toBe(true)
    expect(edited.shots[1].subjectIds).toEqual(plan.shots[1].subjectIds)
  })

  it('builds a whitebox project that the existing timeline can play', () => {
    const plan = normalizeDirectorPrompt('A character in a room, push in for 2s')
    const built = buildDirectorProjectFromPlan(plan, createDefaultProject('Existing'))
    const scene = built.project.scenes[0]
    expect(built.accepted).toBe(true)
    expect(scene.objects.length).toBeGreaterThan(0)
    expect(scene.cameras[0].motionTrajectory?.length).toBeGreaterThan(0)
    expect(scene.cameras[0].trajectoryClips?.[0]).toMatchObject({ startTime: 0, endTime: 2 })
    expect(scene.timelineTrackOrder[0]).toBe(scene.cameras[0].id)
  })

  it('compiles a bounded whitebox character action into the existing action track', () => {
    const plan = normalizeDirectorPrompt('Shot 1: a character walks forward while the camera follows for 2s')
    const built = buildDirectorProjectFromPlan(plan)
    expect(built.accepted).toBe(true)
    expect(built.project.scenes[0].objects[0].actionClips).toMatchObject([
      { actionPose: 'standard_walk', startTime: 0, endTime: 2 },
    ])
  })

  it('marks follow plans as a camera follow rig while retaining editable waypoints', () => {
    const plan = normalizeDirectorPrompt('A character follows for 2s')
    const built = buildDirectorProjectFromPlan(plan)
    expect(built.project.scenes[0].cameras[0].rigType).toBe('follow')
    expect(built.project.scenes[0].cameras[0].lookAtObjectId).toBe(plan.scene.entities[0].id)
  })

  it('preserves the last playable project when a prompt update is invalid', () => {
    const previous = createDefaultProject('Playable')
    const valid = applyDirectorPrompt(previous, 'A character pushes in for 2s')
    expect(valid.accepted).toBe(true)
    const invalid = applyDirectorPrompt(valid.project, '')
    expect(invalid.accepted).toBe(false)
    expect(invalid.project).toBe(valid.project)
    expect(invalid.status).toMatchObject({ phase: 'error', action: 'edit_prompt', code: 'empty_prompt' })
  })

  it('reports unknown target ids instead of emitting an unplayable track', () => {
    const plan = normalizeDirectorPrompt('A character pushes in for 2s')
    plan.shots[0].motions[0].toTargetId = 'missing-target'
    const built = buildDirectorProjectFromPlan(plan)
    expect(built.accepted).toBe(false)
    expect(built.track.issues[0]).toMatchObject({
      code: 'unknown_target',
      action: 'Choose an existing scene entity as the target.',
    })
  })
})
