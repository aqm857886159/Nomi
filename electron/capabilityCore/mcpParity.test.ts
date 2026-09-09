import { describe, expect, it, vi } from 'vitest'
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } from '../agentLane/laneToolCatalog'
import { toPublishedJsonSchema } from '../shared/agentCapabilities/modelVisibleJsonSchema'
import { MCP_TOOL_RESOLVER } from './mcpToolCatalog'
import { createMcpProtocol } from './mcpProtocol'
import { productionRunToolDescriptors } from '../shared/agentCapabilities/productionRunDescriptors'
import { McpConnectionAuthenticationError } from './mcpConnectionContext'

const lane = [...LANE_MODEL_TOOL_CATALOG, ...LANE_DEFERRED_TOOL_CATALOG]

describe('B6 external MCP parity', () => {
  it('publishes the exact lane timeline plan, not a second field table', () => {
    const actual = MCP_TOOL_RESOLVER.resolve('nomi_timeline_edit')!.inputSchema as { properties: { plan: unknown } }
    const { $schema: _dialect, ...expected } = toPublishedJsonSchema(lane.find(tool => tool.name === 'apply_edit_plan')!.schema)
    expect(actual.properties.plan).toEqual(expected)
  })

  it('retains production semantic field types and bounds inside the external envelope', () => {
    const fields = (name: keyof typeof productionRunToolDescriptors) =>
      toPublishedJsonSchema(productionRunToolDescriptors[name].parameters).properties as Record<string, unknown>
    const external = (name: string) => MCP_TOOL_RESOLVER.resolve(name)!.inputSchema.properties as Record<string, unknown>
    const brief = external('nomi_run_start').brief as { properties: Record<string, unknown> }
    const { playbook: _playbook, playbookVersion: _version, ...semanticBrief } = fields('start_production_run')
    expect(brief.properties).toMatchObject(semanticBrief)
    expect(external('nomi_run_control')).toMatchObject(fields('control_production_run'))
    expect(external('nomi_run_gate')).toMatchObject(fields('decide_production_gate'))
    expect(external('nomi_run_gate')).toMatchObject(fields('materialize_production_storyboard'))
    expect(external('nomi_artifact_review')).toMatchObject(fields('revise_production_artifact'))
  })

  it.each(['initialize', 'tools/list', 'tools/call', 'resources/list', 'resources/read', 'prompts/list', 'prompts/get'])(
    'rejects unverified %s before any invocation and preserves the typed code', async method => {
      const frames: unknown[] = []
      const invoke = vi.fn(async () => ({}))
      const protocol = createMcpProtocol({ send: frame => frames.push(frame), invoke, isAppOpen: () => false,
        getAuthenticatedClient: () => { throw new McpConnectionAuthenticationError() },
      })
      try {
        protocol.handleIncoming({ id: 1, method, params: { name: 'nomi_project_create', arguments: {} } })
        await vi.waitFor(() => expect(frames).toHaveLength(1))
        expect(frames[0]).toMatchObject({ id: 1, error: { code: -32001, data: { code: 'mcp_connection_unauthenticated' } } })
        expect(invoke).not.toHaveBeenCalled()
      } finally { protocol.dispose() }
    },
  )
})
