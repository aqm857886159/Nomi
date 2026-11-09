import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model, Vendor } from './catalog/types';

const fixture = vi.hoisted(() => ({
  call: vi.fn(), read: vi.fn(),
  wav: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]),
  mp4: Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(4)]),
}));
vi.mock('./ai/modelCallBridge', () => ({ callModelOnce: fixture.call }));
vi.mock('./assets/localAssetFile', async original => ({ ...await original<typeof import('./assets/localAssetFile')>(), readNomiLocalAsset: fixture.read }));
vi.mock('./ai/vendorModelConnection', () => ({ nomiModelConfigFor: (_vendor: unknown, model: { meta: { allowed?: string[] } }) => ({
  kind: 'google-generative-ai', modelId: 'custom-omni', inputModalities: model.meta.allowed ?? ['text', 'image', 'audio', 'video'],
}) }));
vi.mock('./runtime', () => ({ billingKindForTaskKind: () => 'text', findExecutableModelForTask: vi.fn() }));

import { executeTextTask } from './textTaskRunner';

const base = { vendor: { key: 'native-relay' } as Vendor, model: { modelKey: 'custom-omni', meta: {} } as Model,
  apiKey: 'fixture-key', kind: 'chat' as const, taskId: 'native-media-task' };

describe('text task original audio and video', () => {
  beforeEach(() => {
    fixture.call.mockReset().mockResolvedValue({ message: { content: [{ type: 'text', text: 'answer' }], stopReason: 'stop' } });
    fixture.read.mockReset().mockImplementation((url: string) => url.endsWith('audio')
      ? { bytes: fixture.wav, contentType: 'audio/wav', fileName: 'voice.wav' }
      : { bytes: fixture.mp4, contentType: 'video/mp4', fileName: 'scene.mp4' });
  });

  it('passes exact original bytes and MIME through the shared model call contract', async () => {
    await executeTextTask({ ...base, request: { kind: 'chat', prompt: 'Compare', extras: {
      referenceAudioUrls: ['nomi-local://asset/project/audio'], referenceVideoUrls: ['nomi-local://asset/project/video'],
    } } });
    expect(fixture.call.mock.calls[0][0].content).toEqual([
      { type: 'text', text: 'Compare' },
      { type: 'file', data: fixture.wav.toString('base64'), mimeType: 'audio/wav', fileName: 'voice.wav' },
      { type: 'file', data: fixture.mp4.toString('base64'), mimeType: 'video/mp4', fileName: 'scene.mp4' },
    ]);
    expect(fixture.read.mock.calls.every(call => call[1].maxBytes > 0)).toBe(true);
  });

  it('refuses unowned remote media URLs instead of fetching an arbitrary URL', async () => {
    await expect(executeTextTask({ ...base, request: { kind: 'chat', prompt: 'Listen', extras: {
      referenceAudioUrls: ['https://unowned.example/file.wav'],
    } } })).rejects.toMatchObject({ code: 'unreadable' });
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
  });

  it('does not submit when original input is missing or its declared kind is wrong', async () => {
    fixture.read.mockReturnValueOnce(null);
    const request = { kind: 'chat' as const, prompt: 'Listen', extras: { referenceAudioUrls: ['nomi-local://asset/project/audio'] } };
    await expect(executeTextTask({ ...base, request })).rejects.toMatchObject({ code: 'unreadable' });
    fixture.read.mockReturnValueOnce({ bytes: fixture.mp4, contentType: 'video/mp4', fileName: 'scene.mp4' });
    await expect(executeTextTask({ ...base, request })).rejects.toMatchObject({ code: 'invalidType' });
    expect(fixture.call).not.toHaveBeenCalled();
  });

  it('does not submit media to a model that has no declared audio input', async () => {
    await expect(executeTextTask({ ...base, model: { ...base.model, meta: { allowed: ['text'] } },
      request: { kind: 'chat', prompt: 'Listen', extras: { referenceAudioUrls: ['nomi-local://asset/project/audio'] } },
    })).rejects.toMatchObject({ code: 'unsupported' });
    expect(fixture.read).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
  });
});
