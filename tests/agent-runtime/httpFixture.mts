import { createServer, type IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';

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

/**
 * 一条助手回复里的**一段**。这是夹具内部唯一的表示：`text` / `tool` 两种回复都先归一成
 * 它，三条协议分支再照它铺开——所以「一条消息里既有文字又有工具调用」不是第三条代码路径，
 * 只是一个 parts 更长的同一条路径（L2 回放影子要逐字回放真实助手回复，而真实回复
 * 经常是 text + toolCall 混在一条里）。
 */
export type FixturePart =
  | { type: 'text'; text: string; chunks?: readonly string[] }
  /**
   * 推理段。**只有 openai-compatible 那条路支持**（`pi-ai` 从 `delta.reasoning_content`
   * 认出它，`api/openai-completions.js:415-437`），另外两条协议给它就直接抛——
   * 一个没验过的 anthropic / responses 推理编码在这里静静地发出去，只会让某天的
   * 「不一致」看起来像投影错了。
   */
  | { type: 'thinking'; text: string }
  | { type: 'toolCall'; id: string; name: string; arguments: unknown };

function refuseThinking(parts: readonly FixturePart[], protocol: string): void {
  if (parts.some((part) => part.type === 'thinking')) {
    throw new Error(`Fixture thinking parts are only wired for openai-completions, not ${protocol}`);
  }
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
  /** 逐段照原样发：段的类型与**顺序**都由调用方给定。L2 回放影子唯一用的那种。 */
  | ({ type: 'message'; parts: readonly FixturePart[] } & FixtureOutput)
  /** 非 2xx。`body` 给了就原样当响应体发（录下来的上游原文），否则发 `{ error: { message } }`。 */
  | { type: 'error'; status: number; message: string; body?: unknown }
  | { type: 'deferred'; beforeReply: () => Promise<FixtureReply> };

/** 三种回复 → 同一串段。夹具里**只有这一个**地方知道 `text` / `tool` 是 `message` 的特例。 */
function partsOf(reply: Extract<FixtureReply, { type: 'text' | 'tool' | 'message' }>): readonly FixturePart[] {
  if (reply.type === 'message') return reply.parts;
  if (reply.type === 'text') {
    return [{ type: 'text', text: reply.text, ...(reply.chunks ? { chunks: reply.chunks } : {}) }];
  }
  return reply.calls.map((call) => ({ type: 'toolCall' as const, id: call.id, name: call.name, arguments: call.arguments }));
}

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
      response.end(JSON.stringify(reply?.body ?? { error: { message: reply?.message ?? 'No fixture reply queued' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
    const usage = { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, reasoning: 0, ...reply.usage };
    const total = usage.total ?? usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`);
    const parts = partsOf(reply);
    const hasToolCall = parts.some((part) => part.type === 'toolCall');
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
      refuseThinking(parts, 'anthropic-messages');
      const blocks = parts.map((part) => part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'tool_use', id: (part as Extract<FixturePart, { type: 'toolCall' }>).id,
            name: (part as Extract<FixturePart, { type: 'toolCall' }>).name,
            input: (part as Extract<FixturePart, { type: 'toolCall' }>).arguments });
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
        : hasToolCall ? 'tool_use' : 'end_turn',
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
      refuseThinking(parts, 'openai-responses');
      let textItems = 0;
      const items = parts.map((part) => part.type === 'text'
        ? { id: `msg-${requests.length}${textItems++ === 0 ? '' : `-${textItems - 1}`}`, type: 'message',
            role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: part.text, annotations: [] }] }
        : { id: `fc_${(part as Extract<FixturePart, { type: 'toolCall' }>).id}`, type: 'function_call',
            status: 'completed', call_id: (part as Extract<FixturePart, { type: 'toolCall' }>).id,
            name: (part as Extract<FixturePart, { type: 'toolCall' }>).name,
            arguments: JSON.stringify((part as Extract<FixturePart, { type: 'toolCall' }>).arguments) });
      items.forEach((item, output_index) => {
        const part = parts[output_index];
        event('response.output_item.added', { output_index, item: { ...item, status: 'in_progress',
          ...(item.type === 'message' ? { content: [] } : { arguments: '' }) } });
        if (part?.type === 'text') {
          event('response.output_text.delta', { output_index, content_index: 0, item_id: item.id, delta: part.text });
        } else if (part?.type === 'toolCall') {
          event('response.function_call_arguments.delta', { output_index, item_id: item.id,
            delta: JSON.stringify(part.arguments) });
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
    // 连着的工具调用并成一条 delta（供应商就是这么发的，也让 `type:'tool'` 的字节
    // 与归一之前一模一样）；文字段照 `chunks` 铺开。段与段之间保持给定顺序。
    const deltas: Array<Record<string, unknown>> = [];
    let toolCallIndex = 0;
    for (const part of parts) {
      if (part.type === 'text') {
        for (const content of part.chunks ?? [part.text]) deltas.push({ role: 'assistant', content });
        continue;
      }
      if (part.type === 'thinking') {
        deltas.push({ role: 'assistant', reasoning_content: part.text });
        continue;
      }
      const call = { index: toolCallIndex++, id: part.id, type: 'function',
        function: { name: part.name, arguments: JSON.stringify(part.arguments) } };
      const previous = deltas.at(-1);
      if (previous && Array.isArray(previous.tool_calls)) previous.tool_calls.push(call);
      else deltas.push({ role: 'assistant', tool_calls: [call] });
    }
    for (const delta of deltas) {
      send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1,
        model: body.model, choices: [{ index: 0, delta, finish_reason: null }] });
    }
    await reply.beforeFinish?.();
    send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1,
      model: body.model, choices: [{ index: 0, delta: {},
        finish_reason: reply.finishReason === 'length' ? 'length' : hasToolCall ? 'tool_calls' : 'stop' }],
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
