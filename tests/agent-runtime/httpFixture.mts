import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { RuntimeTurnRequest } from '../../electron/harness/runtime/runtimePort.js';

export interface CapturedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface FixtureOutput {
  finishReason?: 'stop' | 'length';
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; total?: number; reasoning?: number };
  beforeFinish?: () => Promise<void>;
}

export type FixtureReply =
  /**
   * `chunks` 把同一条 `text` 拆成多个流式 delta 发出去（只走 openai-compatible 那条路）。
   * 缺省时行为一个字节都不变：一条 delta 装完整条文字——182 条既有测试依赖这个默认。
   * 它存在的唯一理由是「一条消息里有第二个 delta」这件事**只能这样制造**，而 0.84.0 的
   * delta-only 改动（上游 #7290）恰恰只在第二个 delta 到达时才分得出对错。
   */
  | ({ type: 'text'; text: string; chunks?: readonly string[] } & FixtureOutput)
  | ({ type: 'tool'; calls: Array<{ id: string; name: string; arguments: unknown }> } & FixtureOutput)
  | { type: 'error'; status: number; message: string }
  | { type: 'deferred'; beforeReply: () => Promise<FixtureReply> };

/** A real HTTP endpoint: only the remote model is simulated, never the SDK loop. */
export async function createHttpFixture(initialReplies: FixtureReply[] = []) {
  const requests: CapturedRequest[] = [];
  const replies = [...initialReplies];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    requests.push({ path: request.url ?? '', headers: request.headers, body });
    let reply = replies.shift();
    while (reply?.type === 'deferred') reply = await reply.beforeReply();
    if (!reply || reply.type === 'error') {
      response.writeHead(reply?.status ?? 500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: reply?.message ?? 'No fixture reply queued' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
    const usage = { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, reasoning: 0, ...reply.usage };
    const total = usage.total ?? usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
    const pathname = new URL(request.url ?? '/', 'http://fixture').pathname;
    if (pathname.endsWith('/messages')) {
      const event = (type: string, value: Record<string, unknown>) => {
        response.write(`event: ${type}\n`);
        send({ type, ...value });
      };
      event('message_start', { message: { id: `msg-${requests.length}`, type: 'message',
        role: 'assistant', model: body.model, content: [], stop_reason: null,
        stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 0,
          cache_read_input_tokens: usage.cacheRead, cache_creation_input_tokens: usage.cacheWrite } } });
      const blocks = reply.type === 'text' ? [{ type: 'text', text: reply.text }]
        : reply.calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments }));
      blocks.forEach((block, index) => {
        event('content_block_start', { index, content_block: block.type === 'text'
          ? { type: 'text', text: '' } : { ...block, input: {} } });
        event('content_block_delta', { index, delta: block.type === 'text'
          ? { type: 'text_delta', text: 'text' in block ? block.text : '' }
          : { type: 'input_json_delta', partial_json: JSON.stringify('input' in block ? block.input : {}) } });
        event('content_block_stop', { index });
      });
      await reply.beforeFinish?.();
      event('message_delta', { delta: { stop_reason: reply.finishReason === 'length' ? 'max_tokens'
        : reply.type === 'tool' ? 'tool_use' : 'end_turn',
        stop_sequence: null }, usage: { output_tokens: usage.output } });
      event('message_stop', {});
      response.end();
      return;
    }
    if (pathname.endsWith('/responses')) {
      let sequence = 0;
      const event = (type: string, value: Record<string, unknown>) => send({ type,
        sequence_number: sequence++, ...value });
      const id = `resp-${requests.length}`;
      event('response.created', { response: { id, status: 'in_progress', output: [] } });
      const items = reply.type === 'text'
        ? [{ id: `msg-${requests.length}`, type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: reply.text, annotations: [] }] }]
        : reply.calls.map((call) => ({ id: `fc_${call.id}`, type: 'function_call', status: 'completed',
            call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) }));
      items.forEach((item, output_index) => {
        event('response.output_item.added', { output_index, item: { ...item, status: 'in_progress',
          ...(item.type === 'message' ? { content: [] } : { arguments: '' }) } });
        if (reply.type === 'text') {
          event('response.output_text.delta', { output_index, content_index: 0, item_id: item.id, delta: reply.text });
        } else {
          event('response.function_call_arguments.delta', { output_index, item_id: item.id,
            delta: JSON.stringify(reply.calls[output_index].arguments) });
        }
        event('response.output_item.done', { output_index, item });
      });
      await reply.beforeFinish?.();
      event(reply.finishReason === 'length' ? 'response.incomplete' : 'response.completed', {
        response: { id, status: reply.finishReason === 'length' ? 'incomplete' : 'completed', output: items,
          ...(reply.finishReason === 'length' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
          usage: { input_tokens: usage.input + usage.cacheRead, output_tokens: usage.output, total_tokens: total,
            input_tokens_details: { cached_tokens: usage.cacheRead },
            output_tokens_details: { reasoning_tokens: usage.reasoning } } } });
      response.end();
      return;
    }
    const deltas = reply.type === 'text'
      ? (reply.chunks ?? [reply.text]).map((content) => ({ role: 'assistant', content }))
      : [{ role: 'assistant', tool_calls: reply.calls.map((call, index) => ({
          index, id: call.id, type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })) }];
    for (const delta of deltas) {
      send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1,
        model: body.model, choices: [{ index: 0, delta, finish_reason: null }] });
    }
    await reply.beforeFinish?.();
    send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1,
      model: body.model, choices: [{ index: 0, delta: {},
        finish_reason: reply.finishReason === 'length' ? 'length' : reply.type === 'tool' ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: usage.input + usage.cacheRead, completion_tokens: usage.output, total_tokens: total,
        prompt_tokens_details: { cached_tokens: usage.cacheRead },
        completion_tokens_details: { reasoning_tokens: usage.reasoning } } });
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP address');
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    push: (...next: FixtureReply[]) => { replies.push(...next); },
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

export async function createRuntimeFixture(t: TestContext, replies: FixtureReply[]) {
  const root = await mkdtemp(join(tmpdir(), 'nomi-runtime-port-'));
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  const tempRoot = join(root, 'scratch');
  await Promise.all([mkdir(cwd), mkdir(agentDir), mkdir(tempRoot)]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const http = await createHttpFixture(replies);
  t.after(http.close);
  const request: RuntimeTurnRequest = {
    cwd, agentDir, tempRoot, systemPrompt: 'NOMI_RUNTIME_SYSTEM',
    model: { kind: 'openai-compatible', providerId: 'nomi-runtime', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key' },
    user: { durableText: 'Read the current shot.' }, tools: [],
    capability: { maxSteps: 8 }, compaction: { enabled: false },
  };
  return { request, http };
}
