import { WorkflowCheckpointNode } from './WorkflowCheckpointNode'
import type { CanvasPluginDefinition } from './canvasPluginTypes'

export const BUNDLED_WORKFLOW_PLUGIN: CanvasPluginDefinition = {
  manifest: {
    id: 'nomi.workflow',
    version: '1.0.0',
    apiVersion: 1,
    permissions: ['canvas.read', 'canvas.write', 'workflow.read', 'workflow.write'],
    nodes: [{ typeId: 'nomi.workflow/checkpoint', schemaVersion: 1, defaultSize: { width: 280, height: 190 } }],
  },
  nodes: [{
    typeId: 'nomi.workflow/checkpoint',
    schemaVersion: 1,
    component: WorkflowCheckpointNode,
  }],
}
