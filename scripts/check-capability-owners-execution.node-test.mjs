import test from 'node:test'
import { canonicalFiles } from './check-capability-owners-fixtures.mjs'
import {
  expectRejected,
  replaceInFunction,
  replaceRequired,
  withFile,
} from './check-capability-owners-test-harness.mjs'

test('canonical execution paths cannot hide direct reads or indirect control-flow executors', async (t) => {
  const transportSource = canonicalFiles['electron/capabilityCore/canvasReadTransportAdapters.ts']
  const mutations = [
    [
      'registry execute direct store sink',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        `export class CapabilityExecutorRegistry { execute(invocation) { return readStore(invocation) } }`,
      ),
    ],
    [
      'Pi transport factory direct store sink',
      withFile(
        'electron/capabilityCore/canvasReadTransportAdapters.ts',
        transportSource.replace('return input.executor.execute(await factory.mint(call))', 'return readStore(call)'),
      ),
    ],
    [
      'Pi transport factory second guarded route',
      withFile(
        'electron/capabilityCore/canvasReadTransportAdapters.ts',
        transportSource.replace(
          `async tryExecute(call) {
          if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null
          return input.executor.execute(await factory.mint(call))
        },`,
          `async tryExecute(call) {
          if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null
          return input.executor.execute(await factory.mint(call))
        },
        async legacyTryExecute(call) {
          return call.toolName === CANVAS_READ_CAPABILITY.aliases.pi
            && input.executor.execute(await factory.mint(call))
        },`,
        ),
      ),
    ],
    [
      'ternary equality executor',
      withFile(
        'src/ternaryEqual.ts',
        `
        import { CANVAS_READ_CAPABILITY } from '../electron/shared/agentCapabilities/canvasRead'
        export function execute(name) { return name === CANVAS_READ_CAPABILITY.aliases.pi ? readStore() : null }
      `,
      ),
    ],
    [
      'ternary inequality executor',
      withFile(
        'src/ternaryNotEqual.ts',
        `
        import { CANVAS_READ_CAPABILITY } from '../electron/shared/agentCapabilities/canvasRead'
        export function execute(name) { return name !== CANVAS_READ_CAPABILITY.aliases.pi ? null : readStore() }
      `,
      ),
    ],
    [
      'unary-not guarded executor',
      withFile(
        'src/unaryNotGuard.ts',
        `
        import { CANVAS_READ_CAPABILITY } from '../electron/shared/agentCapabilities/canvasRead'
        export function execute(name) {
          if (!(name === CANVAS_READ_CAPABILITY.aliases.pi)) return null
          return readStore()
        }
      `,
      ),
    ],
    [
      'derived mismatch executor',
      withFile(
        'src/derivedMismatch.ts',
        `
        import { CANVAS_READ_CAPABILITY } from '../electron/shared/agentCapabilities/canvasRead'
        export function execute(name) {
          const mismatch = name !== CANVAS_READ_CAPABILITY.aliases.pi
          if (mismatch) return null
          return readStore()
        }
      `,
      ),
    ],
    [
      'logical-and executor',
      withFile(
        'src/logicalAnd.ts',
        `
        import { CANVAS_READ_CAPABILITY } from '../electron/shared/agentCapabilities/canvasRead'
        export function execute(name) { return name === CANVAS_READ_CAPABILITY.aliases.pi && readStore() }
      `,
      ),
    ],
  ]
  for (const [name, files] of mutations) {
    await t.test(name, () => expectRejected(files, /direct canvas read sink|second tool-name business switch/i))
  }
})

test('canonical execution APIs reject extra callable routes and referenced read sinks', async (t) => {
  const registrySource = canonicalFiles['electron/capabilityCore/capabilityExecutorRegistry.ts']
  const transportSource = canonicalFiles['electron/capabilityCore/canvasReadTransportAdapters.ts']
  const transportMutation = (name, search, replacement) =>
    withFile(
      'electron/capabilityCore/canvasReadTransportAdapters.ts',
      replaceInFunction(transportSource, name, search, replacement),
    )
  const mutations = [
    [
      'registry extra public gateway route',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          `        })
      }
    }`,
          `        })
      }
      legacyExecute(gateway) { return gateway.readDoc() }
    }`,
          'registry extra route',
        ),
      ),
    ],
    ...[
      ['MCP', 'createMcpCanvasReadTransportAdapter'],
      ['internal', 'createInternalCanvasReadTransportAdapter'],
      ['Pi', 'createPiCanvasReadTransportAdapter'],
      ['captured Pi', 'createCapturedPiCanvasReadTransportAdapter'],
    ].map(([label, factory]) => [
      `${label} transport extra referenced gateway route`,
      transportMutation(
        factory,
        'return Object.freeze({',
        `return Object.freeze({
        legacyExecute: input.gateway.readDoc,`,
      ),
    ]),
    [
      'transport aliased referenced gateway route',
      transportMutation(
        'createMcpCanvasReadTransportAdapter',
        `return Object.freeze({
        execute,`,
        `const legacyExecute = input.gateway.readDoc
      return Object.freeze({
        execute,
        legacyExecute,`,
      ),
    ],
    [
      'transport computed key and referenced gateway route',
      transportMutation(
        'createInternalCanvasReadTransportAdapter',
        `return Object.freeze({
        execute,`,
        `return Object.freeze({
        execute,
        ['legacy' + 'Execute']: input['gateway']['read' + 'Doc'],`,
      ),
    ],
  ]
  for (const [name, files] of mutations) {
    await t.test(name, () => expectRejected(files, /canonical canvas\.read execution|direct canvas read sink/i))
  }
})

test('canonical execution attestation follows the live data path instead of dead call presence', async (t) => {
  const registrySource = canonicalFiles['electron/capabilityCore/capabilityExecutorRegistry.ts']
  const transportSource = canonicalFiles['electron/capabilityCore/canvasReadTransportAdapters.ts']
  const piMutation = (search, replacement) =>
    withFile(
      'electron/capabilityCore/canvasReadTransportAdapters.ts',
      replaceInFunction(transportSource, 'createPiCanvasReadTransportAdapter', search, replacement),
    )
  const mutations = [
    [
      'Pi returned object has unguarded second executor route',
      piMutation(
        `        async tryExecute(call) {`,
        `        async legacyTryExecute(call) {
          const invocation = await factory.mint(call)
          return input.executor.execute(invocation)
        },
        async tryExecute(call) {`,
      ),
    ],
    [
      'Pi canonical tryExecute executes twice',
      piMutation(
        '          return input.executor.execute(await factory.mint(call))',
        `          await input.executor.execute(await factory.mint(call))
          return input.executor.execute(await factory.mint(call))`,
      ),
    ],
    [
      'registry local alias calls a direct store reader beside the canonical path',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          '        const invocation = invocationValue',
          `        const invocation = invocationValue
        const directRead = readStore
        directRead()`,
          'registry alias sink',
        ),
      ),
    ],
    [
      'Pi mint and executor exist only in a dead nested function',
      piMutation(
        `          return input.executor.execute(await factory.mint(call))`,
        `          async function deadRoute() {
            return input.executor.execute(await factory.mint(call))
          }
          void deadRoute
          return null`,
      ),
    ],
    [
      'registry projector exists only in a dead nested function while raw source returns',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          `          await revalidate(invocation)
          return projectOutput(source)`,
          `          await revalidate(invocation)
          function deadProjector() { return projectOutput(source) }
          void deadProjector
          return source`,
          'registry dead projector',
        ),
      ),
    ],
  ]
  for (const [name, files] of mutations) {
    await t.test(name, () => expectRejected(files, /canonical canvas\.read execution|direct canvas read sink/i))
  }
})

test('canonical execution attestation requires dominating guards and direct value provenance', async (t) => {
  const registrySource = canonicalFiles['electron/capabilityCore/capabilityExecutorRegistry.ts']
  const transportSource = canonicalFiles['electron/capabilityCore/canvasReadTransportAdapters.ts']
  const mutateFactory = (name, search, replacement) =>
    withFile(
      'electron/capabilityCore/canvasReadTransportAdapters.ts',
      replaceInFunction(transportSource, name, search, replacement),
    )
  const mutations = [
    [
      'Pi comparison after execution does not dominate the executor',
      mutateFactory(
        'createPiCanvasReadTransportAdapter',
        `          if (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi) return null
          return input.executor.execute(await factory.mint(call))`,
        `          const result = await input.executor.execute(await factory.mint(call))
          void (call.toolName !== CANVAS_READ_CAPABILITY.aliases.pi)
          return result`,
      ),
    ],
    [
      'registry parses a different invocation',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          '        parseInput(invocation)',
          '        parseInput(other)',
          'wrong parse input',
        ),
      ),
    ],
    [
      'transport boxes the minted invocation before execution',
      mutateFactory(
        'createMcpCanvasReadTransportAdapter',
        `        const invocation = await factory.mint({ requestBody })
        return input.executor.execute(invocation)`,
        `        const invocation = [await factory.mint({ requestBody })]
        return input.executor.execute(invocation)`,
      ),
    ],
    [
      'transport return expression discards the executor result',
      mutateFactory(
        'createMcpCanvasReadTransportAdapter',
        '        return input.executor.execute(invocation)',
        '        return [input.executor.execute(invocation), null][1]',
      ),
    ],
    [
      'bounded helper never invokes its live callback',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          `    async function bounded(timeout, signal, execute) {
      void timeout
      return execute(signal)
    }`,
          `    async function bounded(timeout, signal, execute) {
      void timeout
      void signal
      void execute
      return null
    }`,
          'dead bounded callback',
        ),
      ),
    ],
    [
      'dead nested bindings cannot shadow a direct reader alias',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          '        const invocation = invocationValue',
          `        const invocation = invocationValue
        const directRead = readStore
        directRead()
        function shadowAliases() {
          const readStore = safe
          const directRead = safe
          void readStore
          void directRead
        }
        void shadowAliases`,
          'shadowed direct reader',
        ),
      ),
    ],
  ]
  for (const [name, files] of mutations) {
    await t.test(name, () => expectRejected(files, /canonical canvas\.read execution|direct canvas read sink/i))
  }
})

test('canonical execution attestation rejects discarded or unreachable positive evidence', async (t) => {
  const registrySource = canonicalFiles['electron/capabilityCore/capabilityExecutorRegistry.ts']
  const transportSource = canonicalFiles['electron/capabilityCore/canvasReadTransportAdapters.ts']
  const mutateFactory = (name, search, replacement) =>
    withFile(
      'electron/capabilityCore/canvasReadTransportAdapters.ts',
      replaceInFunction(transportSource, name, search, replacement),
    )
  const mutations = [
    [
      'bounded callback result is discarded',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          '      return execute(signal)',
          '      return [execute(signal), null][1]',
          'discarded bounded callback',
        ),
      ),
    ],
    [
      'Pi execution exists only in a constant-false branch',
      mutateFactory(
        'createPiCanvasReadTransportAdapter',
        '          return input.executor.execute(await factory.mint(call))',
        `          if (false) return input.executor.execute(await factory.mint(call))
          return null`,
      ),
    ],
    [
      'Pi executor result is discarded before a null response',
      mutateFactory(
        'createPiCanvasReadTransportAdapter',
        '          return input.executor.execute(await factory.mint(call))',
        `          await input.executor.execute(await factory.mint(call))
          return null`,
      ),
    ],
    [
      'verified factory result is discarded before an evil replacement',
      mutateFactory(
        'createMcpCanvasReadTransportAdapter',
        '      const factory = createMcpCanvasReadVerifiedInvocationFactory({ projectSession: input.projectSession })',
        `      createMcpCanvasReadVerifiedInvocationFactory({ projectSession: input.projectSession })
      const factory = evilFactory()`,
      ),
    ],
    [
      'MCP tryExecute discards its local delegate result',
      mutateFactory(
        'createMcpCanvasReadTransportAdapter',
        '          return { handled: true, result: await execute(requestBody) }',
        '          return { handled: true, result: [await execute(requestBody), null][1] }',
      ),
    ],
    [
      'registry live recipe exists only in a constant-false branch',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          `        return bounded(this.#timeoutMs, options.signal, async (signal) => {
          await revalidate(invocation)
          const port = await this.#resolveCanvasReadPort(invocation)
          await revalidate(invocation)
          const source = await port.read({ signal })
          await revalidate(invocation)
          return projectOutput(source)
        })`,
          `        return bounded(this.#timeoutMs, options.signal, async (signal) => {
          if (false) {
            await revalidate(invocation)
            const port = await this.#resolveCanvasReadPort(invocation)
            await revalidate(invocation)
            const source = await port.read({ signal })
            await revalidate(invocation)
            return projectOutput(source)
          }
          return null
        })`,
          'unreachable registry recipe',
        ),
      ),
    ],
    [
      'MCP mint-to-executor recipe follows an unconditional throw',
      mutateFactory(
        'createMcpCanvasReadTransportAdapter',
        '        const invocation = await factory.mint({ requestBody })',
        `        throw new Error('stop')
        const invocation = await factory.mint({ requestBody })`,
      ),
    ],
    [
      'Pi mint-to-executor recipe follows an unconditional throw',
      mutateFactory(
        'createPiCanvasReadTransportAdapter',
        '          return input.executor.execute(await factory.mint(call))',
        `          throw new Error('stop')
          return input.executor.execute(await factory.mint(call))`,
      ),
    ],
    [
      'registry live recipe follows an unconditional throw',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          `        return bounded(this.#timeoutMs, options.signal, async (signal) => {
          await revalidate(invocation)`,
          `        return bounded(this.#timeoutMs, options.signal, async (signal) => {
          throw new Error('stop')
          await revalidate(invocation)`,
          'registry throw before recipe',
        ),
      ),
    ],
    [
      'bounded callback invocation follows an unconditional throw',
      withFile(
        'electron/capabilityCore/capabilityExecutorRegistry.ts',
        replaceRequired(
          registrySource,
          '      return execute(signal)',
          `      throw new Error('stop')
      return execute(signal)`,
          'bounded throw before callback',
        ),
      ),
    ],
  ]
  for (const [name, files] of mutations) {
    await t.test(name, () => expectRejected(files, /canonical canvas\.read execution|direct canvas read sink/i))
  }
})

test('canonical execution attestation rejects escaped read and executor method references', async (t) => {
  const registrySource = canonicalFiles['electron/capabilityCore/capabilityExecutorRegistry.ts']
  const transportSource = canonicalFiles['electron/capabilityCore/canvasReadTransportAdapters.ts']
  const injectRegistry = (statement) =>
    withFile(
      'electron/capabilityCore/capabilityExecutorRegistry.ts',
      replaceRequired(
        registrySource,
        '        const invocation = invocationValue',
        `        const invocation = invocationValue\n${statement}`,
        'escaped registry reader',
      ),
    )
  const injectMcpExecute = (statement) =>
    withFile(
      'electron/capabilityCore/canvasReadTransportAdapters.ts',
      replaceInFunction(
        transportSource,
        'createMcpCanvasReadTransportAdapter',
        '        return input.executor.execute(invocation)',
        `${statement}\n        return input.executor.execute(invocation)`,
      ),
    )
  const mutations = [
    ['reader invoked through Function.call', injectRegistry('        readStore.call(null)')],
    [
      'reader invoked through a bound method reference',
      injectRegistry(`        const directRead = readStore.bind(null)
        directRead()`),
    ],
    ['reader invoked through a comma-expression callee', injectRegistry('        ;(0, readStore)()')],
    [
      'executor invoked a second time through Function.call',
      injectMcpExecute('        await input.executor.execute.call(input.executor, invocation)'),
    ],
    [
      'executor invoked a second time through a bound method reference',
      injectMcpExecute(`        const secondExecute = input.executor.execute.bind(input.executor)
        await secondExecute(invocation)`),
    ],
    [
      'executor receiver alias cannot be hidden by a dead shadow binding',
      injectMcpExecute(`        const executorAlias = input.executor
        function shadowExecutorAlias() {
          const executorAlias = safe
          void executorAlias
        }
        void shadowExecutorAlias
        await executorAlias.execute.call(executorAlias, invocation)`),
    ],
    [
      'nested destructuring cannot transfer a second executor method',
      injectMcpExecute(`        const { executor: registry, executor: { execute: secondExecute } } = input
        await secondExecute.call(registry, invocation)`),
    ],
    [
      'mint invoked a second time through Function.call',
      withFile(
        'electron/capabilityCore/canvasReadTransportAdapters.ts',
        replaceInFunction(
          transportSource,
          'createMcpCanvasReadTransportAdapter',
          '        const invocation = await factory.mint({ requestBody })',
          `        await factory.mint.call(factory, { requestBody })
        const invocation = await factory.mint({ requestBody })`,
        ),
      ),
    ],
    [
      'verified factory creator invoked a second time through Function.call',
      withFile(
        'electron/capabilityCore/canvasReadTransportAdapters.ts',
        replaceInFunction(
          transportSource,
          'createMcpCanvasReadTransportAdapter',
          '      const factory = createMcpCanvasReadVerifiedInvocationFactory({ projectSession: input.projectSession })',
          `      createMcpCanvasReadVerifiedInvocationFactory.call(null, { projectSession: input.projectSession })
      const factory = createMcpCanvasReadVerifiedInvocationFactory({ projectSession: input.projectSession })`,
        ),
      ),
    ],
  ]
  for (const [name, files] of mutations) {
    await t.test(name, () => expectRejected(files, /canonical canvas\.read execution|direct canvas read sink/i))
  }
})
