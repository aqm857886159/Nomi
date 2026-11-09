import { describe, expect, it } from 'vitest';
import { bindNativeFile, rewriteNativeFilePayload, MAX_NATIVE_REQUEST_BYTES, NativeMediaInputError, NativeMediaBudget } from './nativeFilePayload';

const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftypisom'), Buffer.alloc(4)]);
const file = (mimeType: string, data: Buffer, fileName: string) => bindNativeFile({ type: 'file', mimeType, data: data.toString('base64'), fileName });

describe('native original media request boundary', () => {
  it('reserves the encoded size before reading another original', () => {
    const budget = new NativeMediaBudget();
    budget.reserve('first', 10 * 1024 * 1024);
    expect(budget.remainingBytes('second')).toBeLessThan(6 * 1024 * 1024);
    expect(() => budget.reserve('second', 10 * 1024 * 1024)).toThrow(NativeMediaInputError);
    budget.reserve('first', 9 * 1024 * 1024);
    expect(budget.remainingBytes('second')).toBe(6 * 1024 * 1024);
  });
  it('preserves exact mixed originals and their position in a Google request', () => {
    const audio = file('audio/wav', wav, 'voice.wav');
    const video = file('video/mp4', mp4, 'scene.mp4');
    const source = { contents: [{ role: 'user', parts: [{ text: 'Compare these' }, { text: audio.marker }, { text: video.marker }] }] };
    const result = rewriteNativeFilePayload(source, 'google-generative-ai', [audio, video]);
    expect(result.payload).toEqual({ contents: [{ role: 'user', parts: [{ text: 'Compare these' },
      { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } },
      { inlineData: { mimeType: 'video/mp4', data: mp4.toString('base64') } }] }] });
    expect(result.applied.size).toBe(2);
    expect(source.contents[0].parts[1]).toEqual({ text: audio.marker });
  });

  it('allows audio on explicitly selected OpenAI-compatible input_audio transport', () => {
    const audio = file('audio/wav', wav, 'voice.wav');
    expect(rewriteNativeFilePayload({ messages: [{ role: 'user', content: audio.marker }] }, 'openai-completions', [audio]).payload)
      .toEqual({ messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: audio.data, format: 'wav' } }] }] });
  });

  it('refuses video on an incompatible protocol before a provider can receive filename-only content', () => {
    const video = file('video/mp4', mp4, 'scene.mp4');
    expect(() => rewriteNativeFilePayload({ messages: [{ role: 'user', content: video.marker }] }, 'openai-completions', [video])).toThrow(NativeMediaInputError);
  });

  it('does not inject user data into assistant or tool messages and rejects an unbound reserved marker', () => {
    const audio = file('audio/wav', wav, 'voice.wav');
    const payload = { contents: [{ role: 'model', parts: [{ text: audio.marker }] }, { role: 'user', parts: [{ text: '[nomi-native-file:unknown]' }] }] };
    expect(() => rewriteNativeFilePayload(payload, 'google-generative-ai', [audio])).toThrow(NativeMediaInputError);
    const noUser = { contents: [payload.contents[0]] };
    expect(rewriteNativeFilePayload(noUser, 'google-generative-ai', [audio]).applied.size).toBe(0);
  });

  it('counts the complete encoded request including previous user media', () => {
    const audio = file('audio/wav', wav, 'voice.wav');
    const payload = { contents: [{ role: 'user', parts: [{ text: audio.marker }] }, { role: 'user', parts: [{ text: 'x'.repeat(MAX_NATIVE_REQUEST_BYTES) }] }] };
    expect(() => rewriteNativeFilePayload(payload, 'google-generative-ai', [audio])).toThrow(/20 MiB/);
  });

  it('rejects duplicate bindings and mismatched media bytes', () => {
    const audio = file('audio/wav', wav, 'voice.wav');
    expect(() => rewriteNativeFilePayload({}, 'google-generative-ai', [audio, audio])).toThrow(/Duplicate/);
    expect(() => file('video/mp4', wav, 'lie.mp4')).toThrow(/MIME/);
  });
});
