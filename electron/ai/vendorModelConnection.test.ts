// 目录里的一行 → 一次模型调用的连接配置（Agent lane、文本任务、接入说明卡编译器共用这一份）。
// 2026-10-21 由 vendorLanguageModel.test.ts / anthropicBaseUrl.test.ts 合并而来（ai@4 那一份随栈删除）。
import { describe, expect, it, vi } from 'vitest';
import type { Model, Vendor } from '../catalog/types';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getAppPath: () => process.cwd() } }));
import { anthropicBaseUrl, nomiModelConfigFor, vendorModelConnection } from './vendorModelConnection';

const vendor = (overrides: Partial<Vendor>): Vendor => ({ key: 'relay', name: 'Relay', enabled: true,
  authType: 'bearer', createdAt: '', updatedAt: '', ...overrides });
const model: Model = { modelKey: 'key', modelAlias: ' alias ', vendorKey: 'relay', labelZh: 'Model',
  enabled: true, kind: 'text', createdAt: '', updatedAt: '' };

describe('shared model connection identity', () => {
  it('overrides only the selected text model protocol on a mixed relay', () => {
    const relay = vendor({ providerKind: 'openai-compatible', baseUrlHint: 'https://relay.test/gateway/v1' })
    const omni = { ...model, meta: { textProviderKind: 'google-generative-ai', supportsAudioInput: true, supportsVideoInput: true } }
    expect(nomiModelConfigFor(relay, omni, 'key')).toMatchObject({ kind: 'google-generative-ai', baseURL: 'https://relay.test/gateway/v1beta', inputModalities: ['text', 'image', 'audio', 'video'] })
    expect(nomiModelConfigFor(relay, model, 'key')).toMatchObject({ kind: 'openai-compatible', baseURL: 'https://relay.test/gateway/v1', inputModalities: ['text', 'image'] })
    expect(relay.providerKind).toBe('openai-compatible')
    expect(vendorModelConnection(relay, { ...omni, kind: 'image' }, 'key').kind).toBe('openai-compatible')
  });
  it('normalizes model alias and the default Anthropic URL', () => {
    expect(vendorModelConnection(vendor({ providerKind: 'anthropic', baseUrlHint: '  ' }), model, 'key'))
      .toMatchObject({ kind: 'anthropic', baseURL: 'https://api.anthropic.com/v1', modelId: 'alias' });
  });

  it('keeps a custom Anthropic endpoint (with version joining) and trims OpenAI-compatible bases', () => {
    expect(vendorModelConnection(vendor({ providerKind: 'anthropic', baseUrlHint: ' https://relay.test/messages/ ' }), model, 'key'))
      .toMatchObject({ baseURL: 'https://relay.test/messages/v1' });
    expect(vendorModelConnection(vendor({ providerKind: 'openai-compatible', baseUrlHint: 'https://relay.test/v1/' }), model, ''))
      .toMatchObject({ baseURL: 'https://relay.test/v1' });
  });

  it('builds one config for every model call: provider id, auth, declared output cap and pricing', () => {
    const declared = { ...model, meta: { maxOutputTokens: 8192.7 }, free: true as const };
    expect(nomiModelConfigFor(vendor({ providerKind: 'openai-compatible', baseUrlHint: 'https://relay.test' }), declared, 'sk'))
      .toMatchObject({ providerId: 'relay', authType: 'api-key', apiKey: 'sk', baseURL: 'https://relay.test/v1', maxOutputTokens: 8192, free: true });
    expect(nomiModelConfigFor(vendor({ providerKind: 'openai-compatible', baseUrlHint: 'http://127.0.0.1:11434', authType: 'none' }), model, ''))
      .toMatchObject({ authType: 'none' });
  });
});

// 2026-08-28 用户实测：接上 Claude 后接入检查能过，但画布 Agent 每次 HTTP 404。接入探测会剥掉尾随 /v1、库里存 host root，
// 而运行时要的 base 必须自带版本段。规范化在读的时候做（两台发动机共用这一处），存量只存了根的接入一起救回来。
describe('anthropicBaseUrl — 运行时 base 必须带版本段', () => {
  it('host root 补上 /v1；已带 /v1 的不重复拼；尾随斜杠与空白先归一', () => {
    expect(anthropicBaseUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1');
    expect(anthropicBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1');
    expect(anthropicBaseUrl('https://api.anthropic.com/')).toBe('https://api.anthropic.com/v1');
    expect(anthropicBaseUrl('https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com/v1');
    expect(anthropicBaseUrl('  https://api.anthropic.com  ')).toBe('https://api.anthropic.com/v1');
  });

  it('自建网关的路径前缀原样保留；非 v1 的版本段同样视作已带版本', () => {
    expect(anthropicBaseUrl('https://gw.example.com/anthropic')).toBe('https://gw.example.com/anthropic/v1');
    expect(anthropicBaseUrl('https://gw.example.com/anthropic/v1')).toBe('https://gw.example.com/anthropic/v1');
    expect(anthropicBaseUrl('https://api.anthropic.com/v2')).toBe('https://api.anthropic.com/v2');
  });
});
