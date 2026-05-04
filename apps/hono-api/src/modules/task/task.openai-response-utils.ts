export type OpenAIContentPartForTask =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } | string };

export type OpenAIChatMessageForTask = {
	role: string;
	content: string | OpenAIContentPartForTask[];
};

type ResponsesInputPart =
	| { type: "input_text"; text: string }
	| { type: "input_image"; image_url: string };

export type ParsedTaskJson = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function readRecordProperty(value: unknown, key: string): unknown {
	return isRecord(value) ? value[key] : undefined;
}

export function normalizeOpenAIBaseForTask(baseUrl?: string | null): string {
	const raw = (baseUrl || "https://api.openai.com").trim();
	return raw.replace(/\/+$/, "");
}

export function buildOpenAIResponsesUrlForTask(baseUrl?: string | null): string {
	const normalized = normalizeOpenAIBaseForTask(baseUrl);
	if (/\/responses$/i.test(normalized)) {
		return normalized;
	}
	const hasVersion = /\/v\d+(?:beta)?$/i.test(normalized);
	return `${normalized}${hasVersion ? "" : "/v1"}/responses`;
}

export function buildOpenAIChatCompletionsUrlForTask(baseUrl?: string | null): string {
	const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
	if (!raw) return "https://api.openai.com/v1/chat/completions";
	if (/\/chat\/completions$/i.test(raw)) return raw;
	const hasVersionSegment = /\/v\d+(?:beta)?(\/|$)/i.test(raw);
	return `${raw}${hasVersionSegment ? "" : "/v1"}/chat/completions`;
}

export function buildOpenAIImagesGenerationsUrlForTask(baseUrl?: string | null): string {
	const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
	if (!raw) return "https://api.openai.com/v1/images/generations";
	if (/\/images\/generations$/i.test(raw)) return raw;
	const hasVersionSegment = /\/v\d+(?:beta)?(\/|$)/i.test(raw);
	return `${raw}${hasVersionSegment ? "" : "/v1"}/images/generations`;
}

export function buildOpenAIImagesEditsUrlForTask(baseUrl?: string | null): string {
	const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
	if (!raw) return "https://api.openai.com/v1/images/edits";
	if (/\/images\/edits$/i.test(raw)) return raw;
	const hasVersionSegment = /\/v\d+(?:beta)?(\/|$)/i.test(raw);
	return `${raw}${hasVersionSegment ? "" : "/v1"}/images/edits`;
}

export function normalizeMessageContentForResponses(
	content: string | OpenAIContentPartForTask[],
): OpenAIContentPartForTask[] {
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	return content;
}

export function convertPartForResponses(part: OpenAIContentPartForTask): ResponsesInputPart {
	if (part.type === "text") {
		return { type: "input_text", text: part.text };
	}
	const source =
		typeof part.image_url === "string"
			? part.image_url
			: part.image_url.url;
	return { type: "input_image", image_url: source || "" };
}

export function convertMessagesToResponsesInput(messages: OpenAIChatMessageForTask[]): Array<{
	role: string;
	content: ResponsesInputPart[];
}> {
	return messages.map((msg) => ({
		role: msg.role,
		content: normalizeMessageContentForResponses(msg.content).map(convertPartForResponses),
	}));
}

export function extractTextFromOpenAIResponseForTask(raw: unknown): string {
	const root = isRecord(raw) ? raw : null;
	const choices = root && Array.isArray(root.choices) ? root.choices : null;
	if (choices) {
		const choice = choices[0];
		const message = readRecordProperty(choice, "message");
		const content = readRecordProperty(message, "content");
		if (Array.isArray(content)) {
			return content
				.map((part) => readString(readRecordProperty(part, "text")) || readString(readRecordProperty(part, "content")))
				.join("")
				.trim();
		}
		if (typeof content === "string") {
			return content.trim();
		}
	}

	const output = root ? root.output : null;
	if (Array.isArray(output)) {
		const buffer: string[] = [];
		output.forEach((entry) => {
			const content = readRecordProperty(entry, "content");
			if (!Array.isArray(content)) return;
			content.forEach((part) => {
				const text =
					readString(readRecordProperty(part, "text")) ||
					readString(readRecordProperty(part, "content")) ||
					readString(readRecordProperty(part, "output_text"));
				if (text) buffer.push(text);
			});
		});
		const merged = buffer.join("").trim();
		if (merged) return merged;
	}

	const outputText = root ? root.output_text : null;
	if (Array.isArray(outputText)) {
		const merged = outputText
			.filter((v): v is string => typeof v === "string")
			.join("")
			.trim();
		if (merged) return merged;
	}

	const text = root ? root.text : null;
	if (typeof text === "string") {
		return text.trim();
	}

	return "";
}

export function normalizeImagePromptOutputForTask(text: string): string {
	if (!text) return "";
	let normalized = text.trim();
	normalized = normalized.replace(/^\s*\*{0,2}\s*prompt\s*(?:\*{0,2})?\s*[-:：]\s*(?:\*{0,2})?\s*/i, "");
	if (
		(normalized.startsWith('"') && normalized.endsWith('"')) ||
		(normalized.startsWith("'") && normalized.endsWith("'"))
	) {
		normalized = normalized.slice(1, -1).trim();
	}
	return normalized.trim();
}

export function safeParseJsonForTask(data: string): ParsedTaskJson | null {
	try {
		const parsed: unknown = JSON.parse(data);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function extractTaskJsonErrorMessage(payload: ParsedTaskJson | null): string | null {
	if (!payload) return null;
	const error = payload.error;
	if (typeof error === "string" && error.trim()) return error.trim();
	if (isRecord(error)) {
		const message = error.message;
		if (typeof message === "string" && message.trim()) return message.trim();
	}
	const message = payload.message;
	if (typeof message === "string" && message.trim()) return message.trim();
	return null;
}

export function parseSseJsonPayloadForTask(raw: string): ParsedTaskJson | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	const normalized = raw.replace(/\r/g, "");
	const chunks = normalized.split(/\n\n+/);
	let last: ParsedTaskJson | null = null;
	for (const chunk of chunks) {
		const trimmedChunk = chunk.trim();
		if (!trimmedChunk) continue;
		const lines = trimmedChunk.split("\n");
		for (const line of lines) {
			const match = line.match(/^\s*data:\s*(.+)$/i);
			if (!match) continue;
			const payload = match[1].trim();
			if (!payload || payload === "[DONE]") continue;
			const parsed = safeParseJsonForTask(payload);
			if (parsed) last = parsed;
		}
	}
	return last;
}

export function parseSseResponseForTask(raw: string): ParsedTaskJson | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	const chunks = raw.split(/\n\n+/);
	let completedResponse: ParsedTaskJson | null = null;
	let aggregatedText = "";

	chunks.forEach((chunk) => {
		const trimmed = chunk.trim();
		if (!trimmed) return;

		const dataLines = trimmed
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.filter(Boolean);
		if (!dataLines.length) return;

		const payload = safeParseJsonForTask(dataLines.join("\n"));
		if (!payload) return;

		if (payload.type === "response.completed" && isRecord(payload.response)) {
			completedResponse = payload.response;
			return;
		}

		if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
			aggregatedText += payload.delta;
		}

		if (aggregatedText) return;
		if (payload.type === "response.output_text.done" && typeof payload.text === "string") {
			aggregatedText = payload.text;
			return;
		}
		const part = payload.part;
		if (
			payload.type === "response.content_part.done" &&
			isRecord(part) &&
			typeof part.text === "string"
		) {
			aggregatedText = part.text;
		}
	});

	if (completedResponse) return completedResponse;
	if (aggregatedText) {
		return {
			text: aggregatedText,
			output_text: [aggregatedText],
		};
	}
	return null;
}
