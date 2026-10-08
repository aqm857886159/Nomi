import { MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE } from "./agentCapabilities/verbDeclaration";

/** Shared owner deadline used by both durable receipt writes and read-side recovery. */
export const PROJECT_AGENT_PREPARING_DEADLINE_MS = MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE + 15_000;
