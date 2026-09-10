import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { SparkRenderer } from '@sparkjsdev/spark'

const runtime = vi.hoisted(() => ({ effect: null as null | (() => (() => void)), three: {} as Record<string, unknown> }))
vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>()
  return { ...actual, default: { ...actual, useEffect: (effect: () => (() => void)) => { runtime.effect = effect } } }
})
vi.mock('@react-three/fiber', () => ({ useThree: () => runtime.three }))
import { SparkHost } from './SparkHost'

type InternalSort = { driveSort: () => Promise<void> }
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done }); return { promise, resolve } }
function mount() {
  const scene = new THREE.Scene()
  const gl = { getRenderTarget: () => null, setRenderTarget: vi.fn(), xr: { enabled: false }, autoClear: true }
  runtime.three = { scene, gl }; SparkHost(); const unmount = runtime.effect!()
  const spark = scene.children[0] as SparkRenderer
  // Real Spark accumulator/readback/sort flow; GPU and sorting worker transport are boundary doubles.
  spark.current.target = new THREE.WebGLArrayRenderTarget(1, 1, 1)
  spark.sortWorker = {
    call: vi.fn(async (_name, args) => ({ ...(args as object), activeSplats: 0 })),
    dispose: vi.fn(),
  } as unknown as NonNullable<SparkRenderer['sortWorker']>
  const dispose = vi.spyOn(spark, 'dispose')
  return { scene, spark, unmount, dispose }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SparkHost retirement uses actual Spark 2.1 asynchronous sorting', () => {
  it.each([false, true])('drains readPause before freeing targets (intermediate dirty signal: %s)', async (intermediateSignal) => {
    const { spark, unmount, dispose, scene } = mount()
    spark.sortDirty = true
    const sorting = (spark as unknown as InternalSort).driveSort().then(() => null, (error: unknown) => error)
    expect(spark.sorting).toBe(true)
    unmount()
    if (intermediateSignal) spark.setDirty()
    expect(scene.children).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(await sorting).toBeNull()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(spark.current.target).toBeNull()
  })
  it('cancels queued update and sort admission before disposing an idle renderer', async () => {
    const { spark, unmount, dispose } = mount(); const update = vi.fn(); const sort = vi.fn()
    spark.updateTimeoutId = setTimeout(update, 1) as unknown as number; spark.sortTimeoutId = setTimeout(sort, 1) as unknown as number
    spark.sortDirty = true; unmount(); await vi.advanceTimersByTimeAsync(1)
    expect(update).not.toHaveBeenCalled(); expect(sort).not.toHaveBeenCalled()
    expect(spark.autoUpdate).toBe(false); expect(spark.sortDirty).toBe(false)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('waits for active LoD work and does not require onDirty for an idle empty scene', async () => {
    const { spark, unmount, dispose } = mount(); const lod = deferred()
    spark.lodWorker = { exclusive: vi.fn(async (callback: () => void) => { await lod.promise; callback() }), dispose: vi.fn() } as unknown as NonNullable<SparkRenderer['lodWorker']>
    unmount(); await Promise.resolve()
    expect(dispose).not.toHaveBeenCalled()
    lod.resolve(); await vi.advanceTimersByTimeAsync(0)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('coalesces repeated cleanup without touching a replacement host', async () => {
    const first = mount(); const second = mount()
    first.unmount(); first.unmount(); await vi.advanceTimersByTimeAsync(0)
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).not.toHaveBeenCalled()
    expect(second.scene.children).toEqual([second.spark])
    second.unmount(); await vi.advanceTimersByTimeAsync(0)
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })
  it('disposes an empty host with no sorting target or worker without waiting for a frame', async () => {
    const { spark, unmount, dispose } = mount(); spark.current.dispose(); spark.sortWorker = null
    unmount(); await vi.advanceTimersByTimeAsync(0)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
