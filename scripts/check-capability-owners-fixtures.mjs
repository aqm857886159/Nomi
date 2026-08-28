function entry(file, symbol, role, deleteIn = null) {
  return { file, symbol, role, deleteIn }
}

export const canonicalEntries = [
  entry(
    'electron/shared/agentCapabilities/canvasRead.ts',
    'canvasReadSemanticInputSchema',
    'canonical_input_schema_owner',
  ),
  entry('electron/shared/agentCapabilities/canvasRead.ts', 'canvasReadResultSchema', 'canonical_output_schema_owner'),
  entry('electron/shared/agentCapabilities/canvasRead.ts', 'projectCanvasRead', 'safe_projector'),
  entry('electron/shared/agentCapabilities/canvasRead.ts', 'CANVAS_READ_CAPABILITY.id', 'canonical_id_owner'),
  entry('electron/shared/agentCapabilities/canvasRead.ts', 'CANVAS_READ_CAPABILITY.aliases.pi', 'pi_alias_owner'),
  entry('electron/shared/agentCapabilities/canvasRead.ts', 'CANVAS_READ_CAPABILITY.aliases.mcp', 'mcp_alias_owner'),
  entry('electron/shared/agentCapabilities/canvasRead.ts', 'CANVAS_READ_CAPABILITY.effect', 'canonical_effect_owner'),
]

export const sliceAEntries = [
  ...canonicalEntries,
  entry(
    'electron/shared/agentCapabilities/canvasRead.ts',
    'CANVAS_READ_CAPABILITY.exposure',
    'legacy_authority_exposure_debt',
    'Slice B',
  ),
  entry(
    'src/workbench/generationCanvas/agent/canvasReadCapabilityAdapter.ts',
    'createLiveCanvasReadCapabilityAdapter',
    'renderer_environment_execution_seam',
    'Slice B',
  ),
  entry(
    'electron/capabilityCore/dispatcher.ts',
    'legacyUnverifiedCanvasReadRoute',
    'main_gateway_route_execution_seam',
    'Slice B',
  ),
]

export const canonicalFiles = {
  'electron/shared/agentCapabilities/canvasRead.ts': `
    import { z } from 'zod'
    export const canvasReadSemanticInputSchema = z.object({}).strict()
    export const canvasReadResultSchema = z.object({
      nodes: z.array(z.unknown()),
      edges: z.array(z.unknown()),
      groups: z.array(z.unknown()),
      selectedNodeIds: z.array(z.string()),
    }).strict()
    export function projectCanvasRead(source: unknown) {
      void source
      return canvasReadResultSchema.parse({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    }
    export const CANVAS_READ_CAPABILITY = {
      id: 'canvas.read',
      aliases: { pi: 'read_canvas_state', mcp: 'nomi_read_canvas' },
      inputSchema: canvasReadSemanticInputSchema,
      outputSchema: canvasReadResultSchema,
      effect: 'read',
      execution: { port: 'canvas', availability: 'main_or_renderer' },
      exposure: 'mcp_safe',
      requiredScope: 'canvas:read',
      approval: 'none',
    }
  `,
  'src/workbench/generationCanvas/agent/canvasReadResultSeal.ts': `
    import { projectCanvasRead } from '../../../../electron/shared/agentCapabilities/canvasRead'
    export function captureCanvasReadResult(source: unknown) { return projectCanvasRead(source) }
  `,
  'electron/capabilityCore/dispatcher.ts': `
    export function dispatch(method: string) {
      switch (method) { default: throw new Error(method) }
    }
  `,
  'electron/capabilityCore/capabilityExecutorRegistry.ts': `
    async function bounded(timeout, signal, execute) {
      void timeout
      return execute(signal)
    }
    export class CapabilityExecutorRegistry {
      #resolveCanvasReadPort
      #timeoutMs
      constructor(options) {
        this.#resolveCanvasReadPort = options.resolveCanvasReadPort
        this.#timeoutMs = options.timeoutMs
      }
      async execute(invocationValue, options = {}) {
        assertVerifiedCapabilityInvocation(invocationValue)
        const invocation = invocationValue
        parseInput(invocation)
        return bounded(this.#timeoutMs, options.signal, async (signal) => {
          await revalidate(invocation)
          const port = await this.#resolveCanvasReadPort(invocation)
          await revalidate(invocation)
          const source = await port.read({ signal })
          await revalidate(invocation)
          return projectOutput(source)
        })
      }
    }
  `,
  'electron/capabilityCore/canvasReadTransportAdapters.ts': `
    export function createMcpCanvasReadTransportAdapter(input) {
      const factory = createMcpCanvasReadVerifiedInvocationFactory({ projectSession: input.projectSession })
      const execute = async (requestBody) => {
        const invocation = await factory.mint({ requestBody })
        return input.executor.execute(invocation)
      }
      return Object.freeze({
        execute,
        async tryExecute(method, requestBody) {
          if (!isCanvasReadTransportMethod(method)) return NOT_HANDLED
          return { handled: true, result: await execute(requestBody) }
        },
      })
    }
    export function createInternalCanvasReadTransportAdapter(input) {
      const execute = async (request) => {
        const invocation = await input.factory.mint(request)
        return input.executor.execute(invocation)
      }
      return Object.freeze({
        execute,
        async tryExecute(method, request) {
          if (!isCanvasReadTransportMethod(method)) return NOT_HANDLED
          return { handled: true, result: await execute(request) }
        },
      })
    }
    export function createPiCanvasReadTransportAdapter(input) {
      const factory = createRendererCanvasReadVerifiedInvocationFactory(input)
      return Object.freeze({
        async tryExecute(call) {
          if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null
          return input.executor.execute(await factory.mint(call))
        },
        dispose() {},
      })
    }
    export function createCapturedPiCanvasReadTransportAdapter(input) {
      const factory = createCapturedRendererCanvasReadVerifiedInvocationFactory(input)
      return Object.freeze({
        async tryExecute(call) {
          if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null
          return input.executor.execute(await factory.mint(call))
        },
        dispose() {},
      })
    }
  `,
  'electron/capabilityCore/mcpCapabilityProjection.ts': `
    import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
    const canvasReadTransportJsonSchema = immutableSchemaSnapshot({
      type: 'object',
      properties: { leaseHandle: { type: 'string' }, projectId: { type: 'string' } },
      required: ['leaseHandle'],
      additionalProperties: false,
    })
    export const CANVAS_READ_MCP_ADAPTER = Object.freeze({
      contract: CANVAS_READ_CAPABILITY,
      authority: Object.freeze({
        kind: 'project_session',
        requiredScope: CANVAS_READ_CAPABILITY.requiredScope,
      }),
      port: Object.freeze({ kind: 'canvas', access: 'read' }),
      transportInputSchema: canvasReadTransportJsonSchema,
    })
  `,
}
