import { describe, expect, it, vi } from 'vitest';
import type { Model, Vendor } from '../catalog/types';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getAppPath: () => process.cwd() } }));
vi.mock('./buildAiSdkModel', () => ({ buildAiSdkModel: (input: unknown) => input }));
import { buildLanguageModelForVendor } from './vendorLanguageModel';

const vendor = (overrides: Partial<Vendor>): Vendor => ({ key: 'relay', name: 'Relay', enabled: true,
  authType: 'bearer', createdAt: '', updatedAt: '', ...overrides });
const model: Model = { modelKey: 'key', modelAlias: ' alias ', vendorKey: 'relay', labelZh: 'Model',
  enabled: true, kind: 'text', createdAt: '', updatedAt: '' };

describe('shared model connection identity', () => {
  it('normalizes model alias and explicit default Anthropic URL before either runtime consumes it', () => {
    expect(buildLanguageModelForVendor(vendor({ providerKind: 'anthropic', baseUrlHint: '  ' }), model, 'key'))
      .toMatchObject({ kind: 'anthropic', baseURL: 'https://api.anthropic.com/v1', modelId: 'alias' });
  });
  it('keeps a custom Anthropic endpoint and compatible version joining', () => {
    expect(buildLanguageModelForVendor(vendor({ providerKind: 'anthropic', baseUrlHint: ' https://relay.test/messages/ ' }), model, 'key'))
      .toMatchObject({ baseURL: 'https://relay.test/messages/' });
    expect(buildLanguageModelForVendor(vendor({ providerKind: 'openai-compatible', baseUrlHint: 'https://relay.test/v1/' }), model, ''))
      .toMatchObject({ baseURL: 'https://relay.test/v1' });
  });
});
