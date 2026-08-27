import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { BeforeToolCallContext } from '@earendil-works/pi-agent-core';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TSchema } from 'typebox';
import { z, type ZodTypeAny } from 'zod';
import { ignoreOverride, zodToJsonSchema } from 'zod-to-json-schema';

export type HostToolResult =
  | { status: 'ok'; content: Array<TextContent | ImageContent>; details?: unknown }
  | { status: 'denied' | 'cancelled' | 'error'; message: string };

export interface HostToolDefinition<T extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  schema: T;
  /** The existing Nomi executor owns approval and effects. This only waits for its result. */
  execute(args: z.output<T>, context: { toolCallId: string; signal: AbortSignal }): Promise<HostToolResult>;
}

function awaitHost<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new Error('Nomi tool cancelled'));
    if (signal.aborted) return cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      // Attaching both handlers also consumes late rejections after cancellation.
      void operation().then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
    } catch (error) {
      signal.removeEventListener('abort', cancel);
      reject(error);
    }
  });
}

export function createHostTools(tools: readonly HostToolDefinition[]) {
  const names = new Set<string>();
  const validated = new Map<string, unknown>();
  const definitions: ToolDefinition[] = tools.map((tool) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(tool.name) || names.has(tool.name)) {
      throw new Error(`Invalid or duplicate Nomi tool name: ${tool.name}`);
    }
    names.add(tool.name);
    const parameters = zodToJsonSchema(tool.schema, {
      $refStrategy: 'none', effectStrategy: 'input', removeAdditionalStrategy: 'strict',
      // A preprocess accepts unknown input. Pretending its *output* schema is
      // its input schema makes pi reject valid inputs before Zod can normalize.
      override: (definition) => 'typeName' in definition && definition.typeName === z.ZodFirstPartyTypeKind.ZodEffects &&
        'effect' in definition && (definition.effect as { type: string }).type === 'preprocess'
        ? {} : ignoreOverride,
    });
    return {
      name: tool.name, label: tool.name, description: tool.description,
      parameters: parameters as TSchema, executionMode: 'sequential',
      execute: async (toolCallId, rawArgs, optionalSignal) => {
        const signal = optionalSignal ?? new AbortController().signal;
        void rawArgs;
        if (!validated.has(toolCallId)) throw new Error('Nomi tool arguments were not validated');
        const args = validated.get(toolCallId);
        validated.delete(toolCallId);
        const result = await awaitHost(() => tool.execute(args, { toolCallId, signal }), signal);
        if (result.status !== 'ok') throw new Error(`[${result.status}] ${result.message}`);
        return { content: result.content, details: result.details ?? {} };
      },
    };
  });
  return {
    definitions,
    beforeToolCall: async ({ toolCall }: BeforeToolCallContext, optionalSignal?: AbortSignal) => {
      const tool = tools.find((candidate) => candidate.name === toolCall.name);
      if (!tool) throw new Error(`Tool ${toolCall.name} is not approved by Nomi`);
      const signal = optionalSignal ?? new AbortController().signal;
      // pi's validator coerces numbers and optional nulls. Validate the original
      // JSON with Nomi's Zod contract, and retain its transformed result once.
      const args = await awaitHost(() => tool.schema.parseAsync(toolCall.arguments), signal);
      signal.throwIfAborted();
      validated.set(toolCall.id, args);
    },
    clearPending: () => validated.clear(),
  };
}
