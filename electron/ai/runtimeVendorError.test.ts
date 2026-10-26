import { describe, expect, it } from 'vitest';
import type { RuntimeErrorFacts } from '../shared/agentCapabilities/transportContracts';
import { vendorErrorFromRuntimeFacts } from './runtimeVendorError';

// 映射本体（传输事实 → 结构化错误）。它的生产入口是 modelCallFailure（文本任务、编译器、Agent 车道的 provider 装配点）；
// 结构化载荷穿 IPC 的编码 / 解码往返由 agentError.test.ts 钉住，这里只看映射出来的结构。
const structuredOf = (error: RuntimeErrorFacts) => vendorErrorFromRuntimeFacts(error, 'provider')?.structured ?? null;

describe('pi transport error classification', () => {
  it('maps connection failure into the existing network contract, not a generic provider failure', () => {
    const error: RuntimeErrorFacts = { kind: 'network', message: 'fetch failed: UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error (timeout: 10000ms)',
      code: 'UND_ERR_CONNECT_TIMEOUT', url: 'https://fixture.invalid/v1/chat/completions' };
    const structured = structuredOf(error);
    expect(structured).toMatchObject({ vendorKey: 'provider', category: 'network', retryable: true,
      url: 'https://fixture.invalid/v1/chat/completions', upstreamMsg: expect.stringContaining('UND_ERR_CONNECT_TIMEOUT') });
    expect(structured).not.toHaveProperty('httpStatus');
  });

  it.each([[401, 'auth'], [429, 'quota'], [500, 'server']] as const)('keeps HTTP %s separate from network errors', (status, category) => {
    const structured = structuredOf({ kind: 'http', status, message: `HTTP ${status}`, body: '{"error":{"message":"upstream reason"}}' });
    expect(structured).toMatchObject({ httpStatus: status, category });
  });

  // 上游失败带过 IPC 的通道（vendorHttp 的媒体请求；文本任务、编译器与 Agent 车道共用本文件的映射）都带上游自己的码：
  // 模型下线的 400 只靠状态码会被说成「参数不被接受」。
  it('carries the upstream error code the vendor itself gave, next to its message', () => {
    const structured = structuredOf({ kind: 'http', status: 400,
      message: 'HTTP 400', body: '{"error":{"message":"The requested model is not available right now.","code":"model_not_found"}}' });
    expect(structured).toMatchObject({ httpStatus: 400, category: 'input', upstreamCode: 'model_not_found', upstreamMsg: 'The requested model is not available right now.' });
  });

  it('does not invent a code when the body has none (or has a sentence where a code should be)', () => {
    const none = structuredOf({ kind: 'http', status: 400, message: 'HTTP 400', body: '{"error":{"message":"bad request"}}' });
    const sentence = structuredOf({ kind: 'http', status: 400, message: 'HTTP 400', body: '{"error":{"message":"bad request","code":"this is a whole sentence, not a code"}}' });
    expect(none).not.toHaveProperty('upstreamCode');
    expect(sentence).not.toHaveProperty('upstreamCode');
  });

  it('does not turn caller cancellation into a retryable vendor error', () => {
    expect(vendorErrorFromRuntimeFacts({ kind: 'abort', message: 'User cancelled' }, 'provider')).toBeNull();
  });
});
