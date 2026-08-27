import type { StreamOptions } from '@earendil-works/pi-ai';
import type { NomiModelConfig, RuntimeErrorFacts } from '../runtimePort.js';
import { NativeStreamTimeout } from './observeStream.mjs';
import { networkFailureDetails, redactNetworkMessage, safeNetworkUrl } from '../../../networkErrorDetails.js';

const maximumFactLength = 8192;

export function createErrorFacts(config: NomiModelConfig) {
  const secrets = [config.apiKey, ...Object.values(config.headers ?? {})]
    .filter((value): value is string => Boolean(value)).sort((left, right) => right.length - left.length);
  const lookaheadBytes = secrets.reduce((maximum, secret) => Math.max(maximum, Buffer.byteLength(secret) - 1), 0);
  const clean = (text: string, sourceLength = maximumFactLength) => {
    let output = '';
    const end = Math.min(text.length, sourceLength);
    for (let offset = 0; offset < end && output.length < maximumFactLength;) {
      const secret = secrets.find((value) => text.startsWith(value, offset));
      if (secret) { output += '[redacted]'; offset += secret.length; }
      else {
        const character = String.fromCodePoint(text.codePointAt(offset)!);
        if (output.length + character.length > maximumFactLength) break;
        output += character;
        offset += character.length;
      }
    }
    return output.slice(0, maximumFactLength);
  };
  const describe = (error: unknown): RuntimeErrorFacts => ({
    kind: error instanceof NativeStreamTimeout ? 'timeout' : 'runtime',
    message: clean(error instanceof Error ? error.message : String(error)),
    ...(error instanceof NativeStreamTimeout ? { timeoutPhase: error.phase } : {}),
  });
  return { describe,
    fetch: (send: NonNullable<StreamOptions['fetch']>, record: (facts: RuntimeErrorFacts) => void): NonNullable<StreamOptions['fetch']> =>
      async (input, init) => {
        const source = input instanceof Request ? input.url : String(input);
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        let response: Response;
        try { response = await send(input, init); }
        catch (error) {
          // SDKs may replace a fetch rejection with a message-only timeout.
          // Observe its real cause first, without changing retry/abort semantics.
          const details = !signal?.aborted && networkFailureDetails(error);
          if (details) record({ kind: 'network', ...details,
            message: redactNetworkMessage(details.message, secrets), url: clean(safeNetworkUrl(source)) });
          throw error;
        }
        if (response.ok) return response;
        const captured = await boundedBody(response, signal, lookaheadBytes);
        const body = clean(captured.text, captured.visibleLength);
        if (!signal?.aborted) {
          record({ kind: 'http', status: response.status, body,
            url: clean(safeNetworkUrl(response.url || source)), message: clean(`HTTP ${response.status}: ${body || response.statusText}`) });
        }
        // Observe a clone, not the original SDK body, and never retain request headers.
        return response;
      },
  };
}

async function boundedBody(response: Response, signal: AbortSignal | null | undefined, lookaheadBytes: number) {
  const reader = response.clone().body?.getReader();
  if (!reader) return { text: '', visibleLength: 0 };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  // A literal beginning inside the visible prefix may finish beyond it. Read
  // only enough to recognize that literal; never publish the lookahead itself.
  const byteLimit = maximumFactLength + lookaheadBytes;
  try {
    while (length < byteLimit && !signal?.aborted) {
      const next = await reader.read();
      if (signal?.aborted || next.done) break;
      const chunk = Buffer.from(next.value.subarray(0, byteLimit - length));
      chunks.push(chunk);
      length += chunk.byteLength;
    }
    const bytes = Buffer.concat(chunks);
    const visible = new TextDecoder().decode(bytes.subarray(0, maximumFactLength), { stream: true });
    return { text: new TextDecoder().decode(bytes), visibleLength: visible.length };
  } catch { return { text: '', visibleLength: 0 }; } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}
