import { describe, expect, it } from 'vitest'
import { createCanvasPluginRegistry } from './canvasPluginRegistry'
import type { CanvasPluginDefinition } from './canvasPluginTypes'

const component = (() => null) as CanvasPluginDefinition['nodes'][number]['component']
function plugin(id = 'nomi.test', typeId = 'nomi.test/node'): CanvasPluginDefinition {
  return {
    manifest: {
      id,
      version: '1.0.0',
      apiVersion: 1,
      permissions: ['canvas.read'],
      nodes: [{ typeId, schemaVersion: 1, defaultSize: { width: 200, height: 120 } }],
    },
    nodes: [{ typeId, schemaVersion: 1, component }],
  }
}

describe('canvas plugin registry', () => {
  it('registers and unregisters only when the feature is enabled', () => {
    const registry = createCanvasPluginRegistry({ enabled: true, nomiVersion: '0.21.0', builtInNodeTypes: ['text'] })
    registry.register(plugin())
    expect(registry.resolve('nomi.test/node')).toBeDefined()
    expect(registry.unregister('nomi.test')).toBe(true)
    expect(registry.resolve('nomi.test/node')).toBeUndefined()
  })

  it('rejects malformed manifests, incompatible versions, and collisions', () => {
    const registry = createCanvasPluginRegistry({ enabled: true, nomiVersion: '0.21.0', builtInNodeTypes: ['text', 'nomi.one/node'] })
    expect(() => registry.register({ ...plugin(), manifest: { ...plugin().manifest, id: 'bad' } })).toThrow('invalid canvas plugin manifest')
    expect(() => registry.register({ ...plugin(), manifest: { ...plugin().manifest, apiVersion: 2 as never } })).toThrow('invalid canvas plugin manifest')
    expect(() => registry.register({ ...plugin('nomi.future'), manifest: { ...plugin('nomi.future').manifest, minNomiVersion: '9.0.0' } })).toThrow('requires Nomi')
    expect(() => registry.register(plugin('nomi.one', 'nomi.one/node'))).toThrow('collision')
    registry.register(plugin('nomi.one', 'nomi.one/other'))
    expect(() => registry.register({
      ...plugin('nomi.two', 'nomi.two/node'),
      manifest: {
        ...plugin('nomi.two', 'nomi.two/node').manifest,
        nodes: [
          { typeId: 'nomi.two/node', schemaVersion: 1, defaultSize: { width: 200, height: 120 } },
          { typeId: 'nomi.two/node', schemaVersion: 1, defaultSize: { width: 200, height: 120 } },
        ],
      },
    })).toThrow('duplicate node types')
    expect(() => registry.register({
      ...plugin('nomi.schema', 'nomi.schema/node'),
      nodes: [{ ...plugin('nomi.schema', 'nomi.schema/node').nodes[0], schemaVersion: 2 }],
    })).toThrow('definition mismatch')
    expect(() => registry.register(plugin('nomi.one', 'nomi.one/other'))).toThrow('id already registered')
  })

  it('rejects node types outside the plugin namespace', () => {
    const registry = createCanvasPluginRegistry({ enabled: true, nomiVersion: '1.0.0' })
    expect(() => registry.register(plugin('nomi.test', 'other/plugin-node'))).toThrow(/namespaced by plugin id/)
  })

  it('never exposes a disabled plugin', () => {
    const registry = createCanvasPluginRegistry({ enabled: false, nomiVersion: '0.21.0' })
    expect(() => registry.register(plugin())).toThrow('disabled')
    expect(registry.listManifests()).toEqual([])
  })
})
