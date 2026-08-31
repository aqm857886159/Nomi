import {
  canvasPluginManifestSchema,
  type CanvasPluginDefinition,
  type CanvasPluginNodeDefinition,
  type CanvasPluginRegistry,
} from './canvasPluginTypes'

type RegistryOptions = {
  enabled: boolean
  nomiVersion: string
  builtInNodeTypes?: readonly string[]
}

function versionParts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((value) => Number(value))
  return [major, minor, patch]
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const current = versionParts(version)
  const required = versionParts(minimum)
  return current[0] > required[0] ||
    (current[0] === required[0] && (current[1] > required[1] ||
      (current[1] === required[1] && current[2] >= required[2])))
}

/** Host-owned registry. There is deliberately no import(), fetch(), or filesystem path here. */
export function createCanvasPluginRegistry(options: RegistryOptions): CanvasPluginRegistry {
  const manifests = new Map<string, CanvasPluginDefinition>()
  const nodes = new Map<string, CanvasPluginNodeDefinition>()
  const builtInNodeTypes = new Set(options.builtInNodeTypes || [])

  return {
    isEnabled: () => options.enabled,
    register: (plugin) => {
      if (!options.enabled) throw new Error('canvas plugins are disabled')
      const parsed = canvasPluginManifestSchema.safeParse(plugin.manifest)
      if (!parsed.success) throw new Error(`invalid canvas plugin manifest: ${parsed.error.issues[0]?.message || 'unknown error'}`)
      const manifest = parsed.data
      if (manifests.has(manifest.id)) throw new Error(`canvas plugin id already registered: ${manifest.id}`)
      if (manifest.minNomiVersion && !isVersionAtLeast(options.nomiVersion, manifest.minNomiVersion)) {
        throw new Error(`canvas plugin requires Nomi ${manifest.minNomiVersion} or newer`)
      }
      const manifestTypes = new Set(manifest.nodes.map((node) => node.typeId))
      if (manifestTypes.size !== manifest.nodes.length) throw new Error(`canvas plugin has duplicate node types: ${manifest.id}`)
      for (const node of manifest.nodes) {
        if (!node.typeId.startsWith(`${manifest.id}/`)) {
          throw new Error(`canvas plugin node type must be namespaced by plugin id: ${node.typeId}`)
        }
        if (builtInNodeTypes.has(node.typeId) || nodes.has(node.typeId)) {
          throw new Error(`canvas plugin node type collision: ${node.typeId}`)
        }
        const definition = plugin.nodes.find((candidate) => candidate.typeId === node.typeId)
        if (!definition || definition.schemaVersion !== node.schemaVersion) {
          throw new Error(`canvas plugin node definition mismatch: ${node.typeId}`)
        }
      }
      manifests.set(manifest.id, plugin)
      manifest.nodes.forEach((node) => nodes.set(node.typeId, plugin.nodes.find((candidate) => candidate.typeId === node.typeId)!))
    },
    unregister: (pluginId) => {
      const plugin = manifests.get(pluginId)
      if (!plugin) return false
      manifests.delete(pluginId)
      plugin.nodes.forEach((node) => nodes.delete(node.typeId))
      return true
    },
    resolve: (typeId) => options.enabled ? nodes.get(typeId) : undefined,
    getManifest: (pluginId) => options.enabled ? manifests.get(pluginId)?.manifest : undefined,
    listManifests: () => options.enabled ? Array.from(manifests.values(), (plugin) => plugin.manifest) : [],
  }
}
