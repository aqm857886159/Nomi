import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { canonicalEntries, canonicalFiles, sliceAEntries } from './check-capability-owners-fixtures.mjs'
import './check-capability-owners-execution.node-test.mjs'
import { cleanup, expectRejected, makeFixture, runChecker, withFile } from './check-capability-owners-test-harness.mjs'

test('the canonical canvas.read owners pass with zero migration debt after atomic cutover', () => {
  const fixture = makeFixture()
  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(fixture)
  }
})

test('canonical id, schema, alias, effect, and projector owners are singular', async (t) => {
  const mutations = [
    {
      name: 'second canonical contract',
      file: 'electron/duplicateContract.ts',
      source: `
        import { z } from 'zod'
        const input = z.object({}).strict()
        const output = z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()), groups: z.array(z.unknown()), selectedNodeIds: z.array(z.string()) })
        export const OTHER = { id: 'canvas.read', aliases: { pi: 'read_canvas_state', mcp: 'nomi_read_canvas' }, inputSchema: input, outputSchema: output, effect: 'read', execution: { port: 'canvas' }, exposure: 'legacy_unverified' }
      `,
      diagnostic: /canonical_id_owner.*exactly one|unregistered owner.*OTHER\.id/s,
    },
    {
      name: 'second semantic input schema owner',
      file: 'electron/shared/agentCapabilities/duplicateInput.ts',
      source: `import { z } from 'zod'; export const disguisedCanvasReadInputSchema = z.object({}).strict()`,
      diagnostic: /canonical_input_schema_owner.*exactly one|duplicate canonical input schema/i,
    },
    {
      name: 'second output schema owner',
      file: 'electron/shared/agentCapabilities/duplicateOutput.ts',
      source: `
        import { z } from 'zod'
        export const disguisedCanvasReadOutputSchema = z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()), groups: z.array(z.unknown()), selectedNodeIds: z.array(z.string()) }).strict()
      `,
      diagnostic: /canonical_output_schema_owner.*exactly one|duplicate canonical output schema/i,
    },
    {
      name: 'second effect owner',
      file: 'electron/duplicateEffect.ts',
      source: `export const CANVAS_READ_EFFECT = 'read'; export const capabilityId = 'canvas.read'`,
      diagnostic: /canonical_effect_owner.*exactly one|duplicate canvas\.read effect owner/i,
    },
    {
      name: 'second safe projector',
      file: 'electron/projectCanvasAgain.ts',
      source: `
        import type { CanvasReadResult } from './shared/agentCapabilities/canvasRead'
        export function harmlessLooking(source: unknown): CanvasReadResult {
          return { nodes: source.nodes, edges: source.edges, groups: source.groups, selectedNodeIds: source.selectedNodeIds }
        }
      `,
      diagnostic: /second safe projector|field whitelist owner|unregistered owner/i,
    },
    {
      name: 'disguised field whitelist wrapper',
      file: 'electron/projectWithWhitelist.ts',
      source: `
        import type { CanvasReadResult } from './shared/agentCapabilities/canvasRead'
        const allowed = ['nodes', 'edges', 'groups', 'selectedNodeIds'] as const
        export function select(value: unknown): CanvasReadResult { return Object.fromEntries(allowed.map((key) => [key, value[key]])) }
      `,
      diagnostic: /field whitelist owner|second safe projector/i,
    },
  ]

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      expectRejected(withFile(mutation.file, mutation.source), mutation.diagnostic)
    })
  }
})

test('document.read schema owners are singular without adding a second baseline vocabulary', () => {
  const documentContract = `
    import { z } from 'zod'
    export const documentReadSemanticInputSchema = z.object({ scope: z.enum(['full', 'selection']) }).strict()
    export const documentReadResultSchema = z.object({ text: z.string() }).strict()
    export function projectDocumentRead(source) { return documentReadResultSchema.parse(source) }
    export const DOCUMENT_READ_CAPABILITY = { id: 'document.read', aliases: { pi: 'read_full_text' }, inputSchema: documentReadSemanticInputSchema, outputSchema: documentReadResultSchema, effect: 'read' }
  `
  expectRejected(
    {
      ...canonicalFiles,
      'electron/shared/agentCapabilities/documentRead.ts': documentContract,
      'electron/shared/agentCapabilities/duplicateDocumentRead.ts': `import { z } from 'zod'; export const documentReadSemanticInputSchema = z.object({ scope: z.string() })`,
    },
    /document\.read documentReadSemanticInputSchema must have exactly one owner/,
  )
})

test('computed properties and Map registrations cannot collide with canonical aliases', async (t) => {
  const mutations = [
    {
      name: 'computed Pi alias',
      file: 'electron/aliasComputed.ts',
      source: `const handlers = { ['read_' + 'canvas_state']: () => null }`,
      diagnostic: /alias collision.*read_canvas_state/i,
    },
    {
      name: 'computed MCP alias in Map',
      file: 'electron/aliasMap.ts',
      source: "const handlers = new Map([[`nomi_${'read'}_canvas`, () => null]])",
      diagnostic: /alias collision.*nomi_read_canvas/i,
    },
  ]
  for (const mutation of mutations) {
    await t.test(mutation.name, () => expectRejected(withFile(mutation.file, mutation.source), mutation.diagnostic))
  }
})

test('a second tool-name business switch or executor is rejected', async (t) => {
  const mutations = [
    {
      name: 'comparison switch',
      file: 'electron/secondExecutor.ts',
      source: `
        import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
        export function execute(toolName) { if (toolName === CANVAS_READ_CAPABILITY.aliases.pi) return run() }
      `,
    },
    {
      name: 'Map executor',
      file: 'electron/secondExecutorMap.ts',
      source: `
        import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
        const executors = new Map([[CANVAS_READ_CAPABILITY.aliases.pi, () => run()]])
      `,
    },
    {
      name: 'switch executor',
      file: 'electron/secondExecutorSwitch.ts',
      source: `
        import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
        export function execute(toolName) { switch (toolName) { case CANVAS_READ_CAPABILITY.aliases.pi: return run() } }
      `,
    },
    {
      name: 'computed handler object',
      file: 'electron/secondExecutorObject.ts',
      source: `
        import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
        const executors = { [CANVAS_READ_CAPABILITY.aliases.pi]: () => run() }
      `,
    },
  ]
  for (const mutation of mutations) {
    await t.test(mutation.name, () =>
      expectRejected(
        withFile(mutation.file, mutation.source),
        /second tool-name business switch|second canvas\.read executor/i,
      ),
    )
  }
})

test('migrated aliases cannot return to Pi, MCP, READ_ONLY_TOOLS, or TOOL_META literals', async (t) => {
  const mutations = [
    [
      'electron/harness/tools/canvasDescriptors.ts',
      `export const descriptors = { ['read_' + 'canvas_state']: {} }`,
      'read_canvas_state',
    ],
    [
      'electron/capabilityCore/mcpToolCatalog.ts',
      `export const tools = [{ name: 'nomi_' + 'read_canvas' }]`,
      'nomi_read_canvas',
    ],
    [
      'electron/capabilityCore/mcpProtocol.ts',
      `const READ_ONLY_TOOLS = new Set(['nomi_read_canvas'])`,
      'nomi_read_canvas',
    ],
    [
      'src/workbench/generationCanvas/agent/gate.ts',
      `const TOOL_META = { ['read_canvas_state']: { writes: false } }`,
      'read_canvas_state',
    ],
  ]
  for (const [file, source, alias] of mutations) {
    await t.test(file, () => expectRejected(withFile(file, source), new RegExp(`legacy literal.*${alias}`, 'i')))
  }
})

test('Phase 4 aliases cannot return to renderer policy, Canvas forwarding, or retired dispatchers', async (t) => {
  const mutations = [
    {
      file: 'src/workbench/generationCanvas/agent/gate.ts',
      source: `const TOOL_META = { get_media: { writes: false }, delete_canvas_nodes: { writes: true } }`,
      diagnostic: /Phase 4 legacy owner.*gate\.ts.*(?:get_media|delete_canvas_nodes)/i,
    },
    {
      file: 'src/workbench/generationCanvas/agent/applyCanvasToolCall.ts',
      source: `export function applyCanvasToolCall(name) { if (name === 'export_timeline') return legacy() }`,
      diagnostic: /Phase 4 legacy owner.*applyCanvasToolCall\.ts.*export_timeline/i,
    },
    {
      file: 'electron/harness/tools/canvasDescriptors.ts',
      source: `export const descriptors = { delete_canvas_nodes: { name: 'delete_canvas_nodes' } }`,
      diagnostic: /Phase 4 legacy owner.*canvasDescriptors\.ts.*delete_canvas_nodes/i,
    },
    {
      file: 'src/workbench/timeline/agent/timelineToolCall.ts',
      source: `export function applyTimelineToolCall() {}`,
      diagnostic: /Phase 4 retired dispatcher.*timelineToolCall\.ts/i,
    },
  ]
  for (const mutation of mutations) {
    await t.test(mutation.file, () => expectRejected(withFile(mutation.file, mutation.source), mutation.diagnostic))
  }
})

test('shared capability leaves cannot import environment layers', async (t) => {
  for (const dependency of [
    'node:fs',
    'electron',
    'react',
    'zustand',
    '../../capabilityCore/core',
    '../../../src/workbench/store',
  ]) {
    await t.test(dependency, () => {
      expectRejected(
        withFile(
          'electron/shared/agentCapabilities/environmentLeak.ts',
          `import value from '${dependency}'; export { value }`,
        ),
        /shared capability.*forbidden dependency/i,
      )
    })
  }
})

test('canvas.read cannot bind a write or paid adapter port', async (t) => {
  for (const access of ['write', 'paid']) {
    await t.test(access, () => {
      expectRejected(
        withFile(
          'electron/capabilityCore/badPort.ts',
          `import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'; export const adapter = { contract: CANVAS_READ_CAPABILITY, port: { kind: 'canvas', access: '${access}' } }`,
        ),
        new RegExp(`canvas\\.read.*${access} port`, 'i'),
      )
    })
  }
})

test('tests, specs, and docs may mention migration literals without becoming production owners', () => {
  const files = {
    ...canonicalFiles,
    'electron/ignored.test.ts': `const duplicate = { id: 'canvas.read', alias: 'read_canvas_state' }`,
    'src/ignored.spec.ts': `const duplicate = new Map([['nomi_read_canvas', handler]])`,
    'docs/ignored.ts': `export const duplicate = { id: 'canvas.read', effect: 'read' }`,
  }
  const fixture = makeFixture(files)
  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(fixture)
  }
})

test('missing or moved registered owners fail closed', async (t) => {
  await t.test('missing canonical owner path', () => {
    const files = { ...canonicalFiles }
    delete files['electron/shared/agentCapabilities/canvasRead.ts']
    expectRejected(files, /stale or moved owner.*projectCanvasRead|must have exactly one owner/s)
  })
})

test('baseline entries have the exact auditable shape', () => {
  const malformed = canonicalEntries.map((value, index) => (index === 0 ? { ...value, reason: 'trust me' } : value))
  expectRejected(canonicalFiles, /must contain exactly file, symbol, role, deleteIn/, malformed)
})

test('generic canvas persistence snapshots are consumers, not safe-result owners', () => {
  const files = withFile(
    'src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts',
    `
      export function normalizeStoreSnapshot(input: unknown) {
        const value = input as Record<string, unknown>
        return { nodes: value.nodes, edges: value.edges, groups: value.groups, selectedNodeIds: value.selectedNodeIds }
      }
    `,
  )
  const fixture = makeFixture(files)
  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(fixture)
  }
})

test('legal canonical delegates and presentation consumers do not become owners', () => {
  const files = {
    ...canonicalFiles,
    'src/workbench/generationCanvas/agent/canvasPromptContext.ts': `
      import type { CanvasReadResult } from '../../../../electron/shared/agentCapabilities/canvasRead'
      export function formatCanvasForAgent(result: CanvasReadResult) { return result.nodes.map((node) => node.id).join('\\n') }
    `,
    'electron/capabilityCore/mcpProjection.ts': `
      import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
      export const adapter = { contract: CANVAS_READ_CAPABILITY, port: { kind: 'canvas', access: 'read' }, transport: { properties: { projectId: { type: 'string' } } } }
    `,
  }
  const fixture = makeFixture(files)
  try {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(fixture)
  }
})

test('mcp_safe exposure requires the exact canonical project-session adapter and lease wire', async (t) => {
  const projection = canonicalFiles['electron/capabilityCore/mcpCapabilityProjection.ts']
  const mutations = [
    {
      name: 'legacy authority',
      files: withFile(
        'electron/capabilityCore/mcpCapabilityProjection.ts',
        projection.replace(`kind: 'project_session'`, `kind: 'legacy_unverified'`),
      ),
      diagnostic: /mcp_safe.*project_session/i,
    },
    {
      name: 'self-asserted scope literal',
      files: withFile(
        'electron/capabilityCore/mcpCapabilityProjection.ts',
        projection.replace('requiredScope: CANVAS_READ_CAPABILITY.requiredScope', `requiredScope: 'canvas:read'`),
      ),
      diagnostic: /mcp_safe.*canonical requiredScope/i,
    },
    {
      name: 'lease omitted from required wire fields',
      files: withFile(
        'electron/capabilityCore/mcpCapabilityProjection.ts',
        projection.replace(`required: ['leaseHandle']`, `required: []`),
      ),
      diagnostic: /mcp_safe.*leaseHandle.*required/i,
    },
    {
      name: 'synthetic adapter',
      files: withFile(
        'electron/capabilityCore/syntheticCanvasReadProjection.ts',
        `
          import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
          export const SYNTHETIC_CANVAS_READ_MCP_ADAPTER = {
            contract: CANVAS_READ_CAPABILITY,
            authority: { kind: 'project_session', requiredScope: CANVAS_READ_CAPABILITY.requiredScope },
            transportInputSchema: { type: 'object', required: ['leaseHandle'] },
          }
        `,
      ),
      diagnostic: /self-asserted mcp_safe adapter/i,
    },
    {
      name: 'synthetic adapter omitting authority',
      files: withFile(
        'electron/capabilityCore/syntheticCanvasReadProjection.ts',
        `
          import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
          export const SYNTHETIC_CANVAS_READ_MCP_ADAPTER = {
            contract: CANVAS_READ_CAPABILITY,
            transportInputSchema: { type: 'object', required: ['leaseHandle'] },
            parseCall: (args) => args,
          }
        `,
      ),
      diagnostic: /self-asserted mcp_safe adapter/i,
    },
    {
      name: 'same-id contract clone',
      files: withFile(
        'electron/shared/agentCapabilities/syntheticCanvasRead.ts',
        `
          import { CANVAS_READ_CAPABILITY } from './canvasRead'
          export const SYNTHETIC_CANVAS_READ = {
            id: CANVAS_READ_CAPABILITY.id,
            exposure: 'mcp_safe',
          }
        `,
      ),
      diagnostic: /self-asserted mcp_safe exposure/i,
    },
  ]
  for (const mutation of mutations) {
    await t.test(mutation.name, () => expectRejected(mutation.files, mutation.diagnostic))
  }
})

test('Slice B cutover accepts the Slice A historical baseline only after every debt is gone', () => {
  const fixture = makeFixture()
  const reference = path.join(fixture.root, 'reference.json')
  fs.writeFileSync(reference, `${JSON.stringify({ version: 1, entries: sliceAEntries }, null, 2)}\n`)
  try {
    const result = runChecker(fixture, '--reference-baseline', reference)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    cleanup(fixture)
  }
})

test('the current baseline cannot re-register a retired Slice B debt', () => {
  const retiredEntries = sliceAEntries.filter((value) => value.role !== 'legacy_authority_exposure_debt')
  const files = {
    ...canonicalFiles,
    'src/workbench/generationCanvas/agent/canvasReadCapabilityAdapter.ts': `
      export function createLiveCanvasReadCapabilityAdapter() { return { execute() {} } }
    `,
    'electron/capabilityCore/dispatcher.ts': `
      export function legacyUnverifiedCanvasReadRoute() { return run() }
      export function dispatch(method) { switch (method) { case 'canvas.read': return legacyUnverifiedCanvasReadRoute() } }
    `,
  }
  expectRejected(files, /current baseline.*zero.*debt|retired Slice B debt/i, retiredEntries)
})

test('retired Slice B execution seams and imports cannot return under another wrapper', async (t) => {
  const mutations = [
    [
      'live renderer adapter',
      'src/legacyLive.ts',
      `export function createLiveCanvasReadCapabilityAdapter() { return { execute() {} } }`,
    ],
    [
      'captured renderer adapter',
      'src/legacyCaptured.ts',
      `export function createCapturedCanvasReadCapabilityAdapter() { return { execute() {} } }`,
    ],
    [
      'renderer read switch',
      'src/legacySwitch.ts',
      `export function routeCanvasToolCallBeforeAmbientGate() { return run() }`,
    ],
    [
      'legacy dispatcher route',
      'electron/legacyRoute.ts',
      `export function legacyUnverifiedCanvasReadRoute() { return run() }`,
    ],
    [
      'verified dispatcher route',
      'electron/verifiedRoute.ts',
      `export function verifiedProjectCanvasReadRoute() { return run() }`,
    ],
    [
      'gateway executor',
      'electron/capabilityCore/canvasReadGatewayAdapter.ts',
      `export function readCanvasFromGateway() { return run() }`,
    ],
    ['raw renderer action executor', 'src/readCanvasAction.ts', `export const action = { tool: 'read_canvas' }`],
    [
      'raw renderer method executor',
      'src/readCanvasMethod.ts',
      `export const tools = { read_canvas() { return store.readSnapshot() } }`,
    ],
    [
      'negative-guard renderer executor',
      'src/negativeGuard.ts',
      `
      import { CANVAS_READ_CAPABILITY } from '../electron/shared/agentCapabilities/canvasRead'
      export function execute(name) {
        if (name !== CANVAS_READ_CAPABILITY.aliases.pi) return null
        return readStore()
      }
    `,
      /second tool-name business switch or canvas\.read executor/i,
    ],
    [
      'retired adapter import',
      'src/legacyImport.ts',
      `import { createLiveCanvasReadCapabilityAdapter } from './workbench/generationCanvas/agent/canvasReadCapabilityAdapter'; void createLiveCanvasReadCapabilityAdapter`,
    ],
    [
      'retired gateway import',
      'electron/legacyGatewayImport.ts',
      `import { readCanvasFromGateway } from './capabilityCore/canvasReadGatewayAdapter'; void readCanvasFromGateway`,
    ],
  ]
  for (const [name, file, source, diagnostic] of mutations) {
    await t.test(name, () =>
      expectRejected(withFile(file, source), diagnostic ?? /retired canvas\.read execution seam/i),
    )
  }
})

test('shared dependency guard covers re-exports, dynamic imports, require, and globals', async (t) => {
  const mutations = [
    ['re-export', `export { readFile } from 'node:fs'`],
    ['dynamic import', `const dependency = 'node:' + 'fs'; export async function load() { return import(dependency) }`],
    ['require', `const dependency = '../../capabilityCore/core'; export const core = require(dependency)`],
    ['process global', `export const platform = process.platform`],
    ['Buffer global', `export const bytes = Buffer.from('x')`],
  ]
  for (const [name, source] of mutations) {
    await t.test(name, () =>
      expectRejected(
        withFile('electron/shared/agentCapabilities/environmentLeak.ts', source),
        /shared capability.*forbidden (?:dependency|global)/i,
      ),
    )
  }
})

test('derived aliases cannot become a local switch or Map registration', async (t) => {
  const mutations = [
    `
      import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
      const readName = CANVAS_READ_CAPABILITY.aliases.pi
      export function execute(toolName) { if (toolName === readName) return run() }
    `,
    `
      import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
      const readName = CANVAS_READ_CAPABILITY.aliases.pi
      const forwardedName = readName
      export const handlers = new Map([[forwardedName, () => run()]])
    `,
  ]
  for (const [index, source] of mutations.entries()) {
    await t.test(String(index), () =>
      expectRejected(
        withFile(`electron/derivedExecutor${index}.ts`, source),
        /second tool-name business switch|executor/i,
      ),
    )
  }
})

test('malformed historical baselines fail with a diagnostic instead of crashing', () => {
  const fixture = makeFixture()
  const reference = path.join(fixture.root, 'reference.json')
  fs.writeFileSync(reference, `${JSON.stringify({ version: 1, entries: [{ file: 'x' }] }, null, 2)}\n`)
  try {
    const result = runChecker(fixture, '--reference-baseline', reference)
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /invalid historical baseline.*file, symbol, role, deleteIn/s)
    assert.doesNotMatch(result.stderr, /TypeError/)
  } finally {
    cleanup(fixture)
  }
})

test('a spread canonical contract cannot shadow the semantic input schema', () => {
  expectRejected(
    withFile(
      'electron/shadowInputSchema.ts',
      `
        import { z } from 'zod'
        import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
        const shadow = z.object({}).strict()
        export const duplicate = { ...CANVAS_READ_CAPABILITY, inputSchema: shadow }
      `,
    ),
    /canonical_input_schema_owner.*exactly one|shadow.*input schema|unregistered owner/i,
  )
})

test('an explicitly returned CanvasReadResult spread clone is a second projector', () => {
  expectRejected(
    withFile(
      'electron/cloneCanvasReadResult.ts',
      `
        import type { CanvasReadResult } from './shared/agentCapabilities/canvasRead'
        export function alternative(value: any): CanvasReadResult { return { ...value } }
      `,
    ),
    /safe_projector.*exactly one|second safe projector|unregistered owner/i,
  )
})

test('a switch executor cannot use the canonical capability id reference', () => {
  expectRejected(
    withFile(
      'electron/canonicalIdSwitch.ts',
      `
        import { CANVAS_READ_CAPABILITY } from './shared/agentCapabilities/canvasRead'
        export function execute(id: string) { switch (id) { case CANVAS_READ_CAPABILITY.id: return run() } }
      `,
    ),
    /second tool-name business switch|canvas\.read executor/i,
  )
})

test('a two-hop constant cannot hide a forbidden dynamic import', () => {
  expectRejected(
    withFile(
      'electron/shared/agentCapabilities/dynamicLeak.ts',
      `
        const first = 'node:fs'
        const second = first
        export async function load() { return import(second) }
      `,
    ),
    /shared capability.*forbidden dependency.*node:fs/i,
  )
})

test('a shorthand constant cannot hide write access on the read adapter', () => {
  expectRejected(
    withFile(
      'electron/capabilityCore/shorthandWritePort.ts',
      `
        import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
        const access = 'write'
        export const adapter = { contract: CANVAS_READ_CAPABILITY, port: { kind: 'canvas', access } }
      `,
    ),
    /canvas\.read cannot bind a write port/i,
  )
})

test('an array join cannot hide an MCP alias Map collision', () => {
  expectRejected(
    withFile(
      'electron/joinedAliasMap.ts',
      `const handlers = new Map([[['nomi', 'read', 'canvas'].join('_'), () => run()]])`,
    ),
    /alias collision.*nomi_read_canvas|second tool-name business switch|executor/i,
  )
})
