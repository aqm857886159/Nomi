import type { AgentChatRequest } from '../../harness/agentChatContracts'

export type {
  AgentChatRequest,
  AgentChatToolDecision,
} from '../../harness/agentChatContracts'

/**
 * The Host is the sole author of a turn's conversation history: the thread it
 * belongs to is Host state, so a renderer-shaped request must not be able to
 * carry (or smuggle) a `history` scope. Omitting the field here makes that a
 * compile error rather than a review note.
 */
export type ProjectAgentExecutionRequest = Omit<AgentChatRequest, 'history'>
