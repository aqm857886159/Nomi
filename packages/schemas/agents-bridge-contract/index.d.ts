export type AgentsBridgeChatAsset = {
	type?: string;
	url?: string;
	thumbnailUrl?: string;
};

export type AgentsBridgeChatResponse = {
	id?: string;
	text?: string;
	assets?: AgentsBridgeChatAsset[];
	trace?: {
		toolCalls?: Array<Record<string, unknown>>;
		output?: Record<string, unknown>;
		summary?: Record<string, unknown>;
		completion?: Record<string, unknown>;
		planning?: Record<string, unknown>;
		turns?: Array<Record<string, unknown>>;
		runtime?: Record<string, unknown>;
		todoList?: Record<string, unknown>;
		todoEvents?: Array<Record<string, unknown>>;
	};
};

export type AgentsBridgeStreamToolCall = {
	toolCallId?: unknown;
	toolName?: unknown;
	phase?: unknown;
	status?: unknown;
	input?: unknown;
	outputPreview?: unknown;
	startedAt?: unknown;
	finishedAt?: unknown;
	durationMs?: unknown;
	errorMessage?: unknown;
};

export type AgentsBridgeStreamTodoListEvent = {
	threadId?: unknown;
	turnId?: unknown;
	sourceToolCallId?: unknown;
	items?: unknown;
	totalCount?: unknown;
	completedCount?: unknown;
	inProgressCount?: unknown;
};

export type AgentsBridgeStreamEvent =
	| { event: "content"; data: { delta?: string } }
	| { event: "tool"; data: AgentsBridgeStreamToolCall }
	| { event: "todo_list"; data: AgentsBridgeStreamTodoListEvent }
	| { event: "result"; data: { response: AgentsBridgeChatResponse } }
	| { event: "error"; data: { message?: string; code?: string; details?: unknown } }
	| { event: "done"; data: { reason?: string } }
	| {
			event:
				| "thread.started"
				| "turn.started"
				| "item.started"
				| "item.updated"
				| "item.completed"
				| "turn.completed";
			data: Record<string, unknown>;
	  };

export type AgentsBridgeStreamObserver = (
	event: AgentsBridgeStreamEvent,
) => void | Promise<void>;

export type AgentsBridgeAssetRole =
	| "target"
	| "reference"
	| "character"
	| "scene"
	| "prop"
	| "product"
	| "style"
	| "context"
	| "mask";

export type AgentsBridgeAssetInput = {
	assetId?: string;
	assetRefId?: string;
	url: string;
	role: AgentsBridgeAssetRole;
	weight?: number;
	note?: string;
	name?: string;
};

export type AgentsBridgeReferenceImageSlot = {
	slot: string;
	url: string;
	role: string | null;
	label: string | null;
	note: string | null;
};

export type AgentsBridgeRemoteToolDefinition = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

export type AgentsBridgeRemoteToolConfig = {
	endpoint: string;
	authToken?: string;
	apiKey?: string;
	projectId?: string;
	flowId?: string;
	nodeId?: string;
};

export type AgentsBridgeDiagnosticContext = Record<string, unknown> & {
	source: "agents_bridge";
	requestKind: "chat" | "prompt_refine";
};

export type AgentsBridgeChatRequest = {
	prompt: string;
	stream: boolean;
	userId: string;
	systemPrompt?: string;
	responseFormat?: unknown;
	allowedTools?: string[];
	resourceWhitelist?: string[];
	referenceImages?: string[];
	referenceImageSlots?: AgentsBridgeReferenceImageSlot[];
	assetInputs?: AgentsBridgeAssetInput[];
	generationContract?: unknown;
	tapcanvasProjectId?: string;
	tapcanvasFlowId?: string;
	tapcanvasNodeId?: string;
	requiredSkills?: string[];
	allowedSubagentTypes?: string[];
	requireAgentsTeamExecution?: true;
	maxTurns?: number;
	compactPrelude?: true;
	tapcanvasApiBaseUrl?: string;
	tapcanvasAuthorization?: string;
	tapcanvasApiKey?: string;
	remoteTools?: AgentsBridgeRemoteToolDefinition[];
	canvasCapabilityManifest?: unknown;
	remoteToolConfig?: AgentsBridgeRemoteToolConfig;
	forceLocalResourceViaBash?: true;
	privilegedLocalAccess?: true;
	localResourcePaths?: string[];
	modelKey?: string;
	modelAlias?: string;
	sessionId?: string;
	diagnosticContext?: AgentsBridgeDiagnosticContext;
};
