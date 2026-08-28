export const TRANSPORT_FILE = 'electron/capabilityCore/canvasReadTransportAdapters.ts'
export const EXECUTOR_FILE = 'electron/capabilityCore/capabilityExecutorRegistry.ts'
export const EXECUTOR_PATH = 'input.executor.execute'

export const TRANSPORT_SPECS = new Map([
  [
    'createMcpCanvasReadTransportAdapter',
    {
      creatorPath: 'createMcpCanvasReadVerifiedInvocationFactory',
      mintPath: 'factory.mint',
      returnedKeys: ['execute', 'tryExecute'],
      mode: 'delegated',
    },
  ],
  [
    'createInternalCanvasReadTransportAdapter',
    {
      creatorPath: null,
      mintPath: 'input.factory.mint',
      returnedKeys: ['execute', 'tryExecute'],
      mode: 'delegated',
    },
  ],
  [
    'createPiCanvasReadTransportAdapter',
    {
      creatorPath: 'createRendererCanvasReadVerifiedInvocationFactory',
      mintPath: 'factory.mint',
      returnedKeys: ['dispose', 'tryExecute'],
      mode: 'pi',
    },
  ],
  [
    'createCapturedPiCanvasReadTransportAdapter',
    {
      creatorPath: 'createCapturedRendererCanvasReadVerifiedInvocationFactory',
      mintPath: 'factory.mint',
      returnedKeys: ['dispose', 'tryExecute'],
      mode: 'pi',
    },
  ],
])

export const EXPECTED_REGISTRY_MEMBERS = Object.freeze([
  'constructor',
  'method:execute',
  'property:#resolveCanvasReadPort',
  'property:#timeoutMs',
])

export const DIRECT_READ_NAMES = new Set([
  'createDiskGateway',
  'createRendererGateway',
  'makeGateway',
  'readCanvasFromGateway',
  'readDoc',
  'readDocumentSnapshot',
  'readGenerationCanvasSnapshot',
  'readSnapshot',
  'readStore',
])

export const REQUIRED_CANONICAL_EXECUTION_SITES = Object.freeze([
  'CapabilityExecutorRegistry.execute',
  ...TRANSPORT_SPECS.keys(),
])
