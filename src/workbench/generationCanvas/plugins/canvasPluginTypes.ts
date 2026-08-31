import type { ComponentType } from 'react'
import { z } from 'zod'

export const CANVAS_PLUGIN_API_VERSION = 1 as const
export const CANVAS_PLUGIN_ID_PATTERN = /^nomi\.[a-z0-9][a-z0-9-]*$/
export const CANVAS_PLUGIN_NODE_TYPE_PATTERN = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9-]*$/

export const canvasPluginPermissionSchema = z.enum([
  'canvas.read',
  'canvas.write',
  'workflow.read',
  'workflow.write',
])

export const canvasPluginManifestSchema = z.object({
  id: z.string().regex(CANVAS_PLUGIN_ID_PATTERN),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  apiVersion: z.literal(CANVAS_PLUGIN_API_VERSION),
  minNomiVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  permissions: z.array(canvasPluginPermissionSchema).max(4),
  nodes: z.array(z.object({
    typeId: z.string().regex(CANVAS_PLUGIN_NODE_TYPE_PATTERN),
    schemaVersion: z.number().int().positive(),
    defaultSize: z.object({ width: z.number().positive(), height: z.number().positive() }),
  })).min(1),
}).strict()

export type CanvasPluginPermission = z.infer<typeof canvasPluginPermissionSchema>
export type CanvasPluginManifest = z.infer<typeof canvasPluginManifestSchema>

export type CanvasPluginNodeState = {
  pluginId: string
  pluginVersion: string
  typeId: string
  schemaVersion: number
  state: Record<string, unknown>
}

export type CanvasPluginHost = {
  hasPermission: (permission: CanvasPluginPermission) => boolean
  /** The renderer may only replace its own versioned envelope; host fields stay immutable. */
  requestNodePatch: (patch: { pluginState: CanvasPluginNodeState }) => void
}

export type CanvasPluginNodeRenderProps = {
  node: unknown
  selected: boolean
  readOnly?: boolean
  focusFlash?: boolean
  appear?: boolean
  host?: CanvasPluginHost
}

export type CanvasPluginNodeDefinition = {
  typeId: string
  schemaVersion: number
  component: ComponentType<CanvasPluginNodeRenderProps>
  migrate?: (state: Record<string, unknown>, fromVersion: number, toVersion: number) => Record<string, unknown>
}

export type CanvasPluginDefinition = {
  manifest: CanvasPluginManifest
  nodes: readonly CanvasPluginNodeDefinition[]
}

export type CanvasPluginRegistry = {
  isEnabled: () => boolean
  register: (plugin: CanvasPluginDefinition) => void
  unregister: (pluginId: string) => boolean
  resolve: (typeId: string) => CanvasPluginNodeDefinition | undefined
  getManifest: (pluginId: string) => CanvasPluginManifest | undefined
  listManifests: () => CanvasPluginManifest[]
}
