import type { ProjectAgentBridge } from '../../desktop/bridge'
import type {
  ProjectAgentExecutionEvent,
  ProjectAgentHostState,
  ProjectAgentMutationType,
  ProjectAgentPatch,
  ProjectBinding,
} from '../../../electron/shared/projectAgentContracts'
import { getDesktopBridge } from '../../desktop/bridge'

export type ProjectAgentCommand = Readonly<{
  subscriptionId: string
  clientCommandId: string
  knownRevision: number
  type: ProjectAgentMutationType | 'tool.decision'
  payload: unknown
}>

export class ProjectAgentClientError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = 'ProjectAgentClientError'
  }
}

type MainEnvelope<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error?: Readonly<{ code?: unknown }> }>

function unwrap<T>(response: unknown): T {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new ProjectAgentClientError('project_agent_unavailable')
  }
  const envelope = response as MainEnvelope<T>
  if (envelope.ok === true && Object.prototype.hasOwnProperty.call(envelope, 'value')) return envelope.value
  const code = (envelope as { error?: { code?: unknown } }).error?.code
  throw new ProjectAgentClientError(typeof code === 'string' ? code : 'project_agent_unavailable')
}

export type ProjectAgentClient = Readonly<{
  open(binding: ProjectBinding): Promise<{ subscriptionId: string; snapshot: ProjectAgentHostState }>
  snapshot(subscriptionId: string): Promise<ProjectAgentHostState>
  command(command: ProjectAgentCommand): Promise<{
    state: ProjectAgentHostState
    patch: ProjectAgentPatch | null
    replayed: boolean
    snapshotRequired?: boolean
  }>
  release(subscriptionId: string): Promise<{ released: true }>
  onPatch(handler: (patch: ProjectAgentPatch) => void): () => void
  onEvent(handler: (event: ProjectAgentExecutionEvent) => void): () => void
}>

export function createProjectAgentClient(getBridge: () => ProjectAgentBridge | undefined): ProjectAgentClient {
  const requireBridge = (): ProjectAgentBridge => {
    const bridge = getBridge()
    if (!bridge) throw new ProjectAgentClientError('project_agent_unavailable')
    return bridge
  }
  return Object.freeze({
    async open(binding) {
      return unwrap(await requireBridge().open(binding))
    },
    async snapshot(subscriptionId) {
      return unwrap(await requireBridge().snapshot(subscriptionId))
    },
    async command(command) {
      return unwrap(await requireBridge().command(command))
    },
    async release(subscriptionId) {
      return unwrap(await requireBridge().release(subscriptionId))
    },
    onPatch(handler) {
      return requireBridge().onPatch?.(handler) ?? (() => undefined)
    },
    onEvent(handler) {
      return requireBridge().onEvent?.(handler) ?? (() => undefined)
    },
  })
}

export const projectAgentClient = createProjectAgentClient(() => getDesktopBridge()?.projectAgent)
