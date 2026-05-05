import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV2 } from "@ai-sdk/provider";

export type { LanguageModelV2 as LanguageModel };

export function getModel(modelId: string): LanguageModelV2 {
	if (modelId.startsWith("claude-")) {
		return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId);
	}
	if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3")) {
		return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId);
	}
	if (modelId.startsWith("gemini-")) {
		return createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })(modelId);
	}
	throw new Error(`Unknown model prefix for model: ${modelId}`);
}
