import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { DirectorObject } from '../../model/directorTypes'

type Effect = { deps?: readonly unknown[]; cleanup?: (() => void) | void }
type Mesh = THREE.Object3D & { resolve: () => void; reject: () => void; dispose: ReturnType<typeof vi.fn> }
const runtime = vi.hoisted(() => ({
  refs: [] as { current: unknown }[], effects: [] as Effect[], pending: [] as (() => void)[], refIndex: 0, effectIndex: 0,
  meshes: [] as Mesh[], begin: vi.fn(), end: vi.fn(), toast: vi.fn(), reveal: vi.fn(),
  t: (_key: string, { name }: { name: string }) => `zh:${name}`, frame: (_state: unknown, _delta: number) => {},
}))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  const effect = (setup: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = runtime.effectIndex++; const previous = runtime.effects[index]
    if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      runtime.pending.push(() => { previous?.cleanup?.(); runtime.effects[index] = { deps, cleanup: setup() } })
    }
  }
  return { ...actual, default: { ...actual, useRef: (current: unknown) => runtime.refs[runtime.refIndex++] ??= { current }, useEffect: effect, useLayoutEffect: effect } }
})
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: typeof runtime.frame) => { runtime.frame = frame } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: runtime.t }) }))
vi.mock('../../../../../../ui/toast', () => ({ toast: runtime.toast }))
vi.mock('../../DirectorEditorContext', () => {
  const store = { getState: () => ({ beginRevealBackdrop: runtime.begin, endRevealBackdrop: runtime.end }) }
  return { useDirectorStoreApi: () => store }
})
vi.mock('../environment/splatRevealDyno', () => ({ createSplatReveal: runtime.reveal }))
vi.mock('@sparkjsdev/spark', async () => {
  const { Object3D } = await import('three')
  return { SplatMesh: class extends Object3D {
    resolve!: () => void; reject!: () => void; dispose = vi.fn()
    initialized = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = () => reject(new Error('decode')) })
    constructor() { super(); runtime.meshes.push(this) }
  } }
})
import { SplatEntity } from './SplatEntity'

let group: THREE.Group
function render(patch: Partial<DirectorObject> = {}) {
  runtime.refIndex = 0; runtime.effectIndex = 0; runtime.pending = []
  const element = SplatEntity({ object: { id: 'splat', name: 'Valley', modelPath: '/valley.spz', ...patch } as DirectorObject })
  ;(element as unknown as { ref: { current: THREE.Group } }).ref.current = group
  runtime.pending.forEach((effect) => effect())
}
const flushLoad = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  vi.clearAllMocks(); runtime.refs = []; runtime.effects = []; runtime.meshes = []; group = new THREE.Group()
  runtime.t = (_key, { name }) => `zh:${name}`
  runtime.reveal.mockImplementation(() => ({ tick: vi.fn(), isActive: () => false, dispose: vi.fn() }))
})
afterEach(() => runtime.effects.forEach((effect) => effect.cleanup?.()))

describe('splat resource identity and asynchronous lifecycle', () => {
  it.each(['rename', 'language'] as const)('keeps the decoded mesh and closed backdrop after %s', async (change) => {
    render(); const mesh = runtime.meshes[0]; mesh.resolve(); await flushLoad(); runtime.frame(null, 1)
    expect(runtime.end).toHaveBeenCalledTimes(1)
    if (change === 'language') runtime.t = (_key, { name }) => `en:${name}`
    render(change === 'rename' ? { name: 'Renamed' } : {})
    expect(runtime.meshes).toHaveLength(1)
    expect(group.children).toEqual([mesh])
    expect(mesh.dispose).not.toHaveBeenCalled()
    expect(runtime.begin).toHaveBeenCalledTimes(1)
  })
  it('uses the latest committed name and language if the current load fails', async () => {
    render(); const mesh = runtime.meshes[0]
    runtime.t = (_key, { name }) => `en:${name}`; render({ name: 'Renamed' })
    mesh.reject(); await flushLoad()
    expect(runtime.toast).toHaveBeenCalledWith('en:Renamed', 'error')
    expect(runtime.end).toHaveBeenCalledTimes(1)
    expect(runtime.meshes).toHaveLength(1)
  })
  it('replaces a changed source once and discards its predecessor loading late', async () => {
    render(); const old = runtime.meshes[0]; render({ modelPath: '/second.ply' })
    const next = runtime.meshes[1]; old.resolve(); await flushLoad()
    expect(runtime.reveal).not.toHaveBeenCalled()
    expect(old.dispose).toHaveBeenCalledTimes(1)
    next.resolve(); await flushLoad(); runtime.frame(null, 1)
    expect(runtime.reveal).toHaveBeenCalledExactlyOnceWith(next)
    expect(group.children).toEqual([next])
    expect(runtime.begin).toHaveBeenCalledTimes(2)
    expect(runtime.end).toHaveBeenCalledTimes(2)
    render({ modelPath: '' }); expect(next.dispose).toHaveBeenCalledTimes(1)
    expect(runtime.end).toHaveBeenCalledTimes(2)
  })
  it('suppresses a cancelled load failure after unmount and closes its backdrop once', async () => {
    render(); const mesh = runtime.meshes[0]
    runtime.effects.forEach((effect) => effect.cleanup?.()); runtime.effects = []
    mesh.reject(); await flushLoad()
    expect(runtime.toast).not.toHaveBeenCalled()
    expect(runtime.end).toHaveBeenCalledTimes(1)
    expect(mesh.dispose).toHaveBeenCalledTimes(1)
    expect(group.children).toHaveLength(0)
  })
})
