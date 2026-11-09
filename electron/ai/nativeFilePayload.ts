import { createHash } from 'node:crypto';
import { contentTypeFromMagicBytes } from '../assets/mediaTypes';
import { desktopT } from '../desktopStrings';
import type { NativeFileContent, NativeInputModality } from '../shared/agentLane/nativeModelInput';

export type NativeFile = NativeFileContent & { marker: string };
export const MAX_NATIVE_REQUEST_BYTES = 20 * 1024 * 1024;
export const MAX_NATIVE_FILE_BYTES = Math.floor(MAX_NATIVE_REQUEST_BYTES * 3 / 4) - 4096;
const MARKER = /^\[nomi-native-file:[a-f0-9]{64}\]$/;

/** Shared by every historical user message in a single outgoing request. */
export class NativeMediaBudget {
  private encodedBytes = 0;
  private readonly reservations = new Map<string, number>();
  reserve(key: string, byteLength: number): void {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new NativeMediaInputError('invalidType', { file: key, mimeType: 'unknown' });
    const encoded = Math.ceil(byteLength / 3) * 4;
    const total = this.encodedBytes - (this.reservations.get(key) ?? 0) + encoded;
    if (total > MAX_NATIVE_REQUEST_BYTES) throw new NativeMediaInputError('tooLarge');
    this.encodedBytes = total;
    this.reservations.set(key, encoded);
  }
  remainingBytes(key: string): number {
    return Math.max(0, Math.floor((MAX_NATIVE_REQUEST_BYTES - this.encodedBytes + (this.reservations.get(key) ?? 0)) / 4) * 3);
  }
}

export function assertNativeRequestBodySize(body: string): void {
  if (Buffer.byteLength(body, 'utf8') > MAX_NATIVE_REQUEST_BYTES) throw new NativeMediaInputError('tooLarge');
}

/** Provider-owned final invariant: a plugin hook must never turn a failed rewrite into a send. */
export function assertNoUnresolvedNativeFiles(payload: unknown, _api: string): void {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (body?.includes('[nomi-native-file:') || body?.includes('[nomi-pdf:')) throw new NativeMediaInputError('unbound');
}

export class NativeMediaInputError extends Error {
  constructor(readonly code: 'unsupported' | 'unreadable' | 'invalidType' | 'tooLarge' | 'unbound', details: Record<string, string> = {}) {
    super(desktopT(`nativeMedia.${code}`, details));
    this.name = 'NativeMediaInputError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function nativeMediaKind(mimeType: string): 'audio' | 'video' | undefined {
  const mime = mimeType.toLowerCase().split(';', 1)[0].trim();
  return mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : undefined;
}

/** Capabilities are explicit declarations, independent of model/vendor names. */
export function assertNativeFileCapability(file: NativeFileContent, modalities: readonly NativeInputModality[] | undefined): void {
  const kind = nativeMediaKind(file.mimeType);
  if (kind) assertNativeMediaCapability(kind, modalities, file.fileName);
}

export function assertNativeMediaCapability(kind: 'audio' | 'video', modalities: readonly NativeInputModality[] | undefined, fileName: string): void {
  if (!modalities?.includes(kind)) throw new NativeMediaInputError('unsupported', { file: fileName, media: kind });
}

export function validateNativeFileBytes(bytes: Uint8Array, mimeType: string, fileName: string): void {
  mimeType = mimeType.toLowerCase().split(';', 1)[0].trim();
  const kind = nativeMediaKind(mimeType);
  if (!kind && mimeType !== 'application/pdf') throw new NativeMediaInputError('invalidType', { file: fileName, mimeType });
  if (!bytes.length) throw new NativeMediaInputError('unreadable', { file: fileName });
  if (kind && bytes.length > MAX_NATIVE_FILE_BYTES) throw new NativeMediaInputError('tooLarge');
  const detected = kind && contentTypeFromMagicBytes(bytes);
  // Container variants can carry audio-only WebM. All other recognized MIME types must agree.
  const aliases: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'video/x-m4v': 'video/mp4' };
  const normalized = aliases[mimeType] ?? mimeType;
  const actual = detected && (aliases[detected] ?? detected);
  if (kind && (!actual || (actual !== normalized && !(normalized === 'audio/webm' && actual === 'video/webm')))) {
    throw new NativeMediaInputError('invalidType', { file: fileName, mimeType });
  }
}

export function bindNativeFile(file: NativeFileContent): NativeFile {
  const mimeType = file.mimeType.toLowerCase().split(';', 1)[0].trim();
  if (!file.data || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) || file.data.length % 4 !== 0) {
    throw new NativeMediaInputError('unreadable', { file: file.fileName });
  }
  if (file.data.length > MAX_NATIVE_REQUEST_BYTES) throw new NativeMediaInputError('tooLarge');
  validateNativeFileBytes(Buffer.from(file.data, 'base64'), mimeType, file.fileName);
  const marker = `[nomi-native-file:${createHash('sha256').update(mimeType).update('\0').update(file.fileName).update('\0').update(file.data).digest('hex')}]`;
  return { ...file, mimeType, marker };
}

function filePart(file: NativeFile, api: string): unknown {
  if (api === 'google-generative-ai') return { inlineData: { mimeType: file.mimeType, data: file.data } };
  if (file.mimeType === 'application/pdf') {
    if (api === 'anthropic-messages') return { type: 'document', source: { type: 'base64', media_type: file.mimeType, data: file.data } };
    if (api === 'openai-responses') return { type: 'input_file', filename: file.fileName, file_data: `data:${file.mimeType};base64,${file.data}` };
  }
  if (api === 'openai-completions' && ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'].includes(file.mimeType)) {
    return { type: 'input_audio', input_audio: { data: file.data, format: file.mimeType.includes('wav') ? 'wav' : 'mp3' } };
  }
  throw new NativeMediaInputError('unsupported', { file: file.fileName, media: file.mimeType });
}

/** Rewrite only main-owned exact markers in user messages; no bytes are written into history. */
export function rewriteNativeFilePayload(payload: unknown, api: string, files: readonly NativeFile[]) {
  const applied = new Set<string>();
  if (!files.length) return { payload, applied };
  const byMarker = new Map(files.map(file => [file.marker, file]));
  if (byMarker.size !== files.length) throw new Error('Duplicate native file marker');
  const replace = (part: unknown): unknown => {
    if (!object(part) || typeof part.text !== 'string') return part;
    if (api !== 'google-generative-ai' && part.type !== 'text' && part.type !== 'input_text') return part;
    const file = byMarker.get(part.text);
    if (!file) {
      if (MARKER.test(part.text) || part.text.startsWith('[nomi-native-file:')) throw new NativeMediaInputError('unbound');
      return part;
    }
    applied.add(file.marker);
    return filePart(file, api);
  };
  const field = api === 'google-generative-ai' ? 'contents' : api === 'openai-responses' ? 'input' : 'messages';
  const contentField = api === 'google-generative-ai' ? 'parts' : 'content';
  if (!object(payload) || !Array.isArray(payload[field])) throw new Error('Unexpected native file provider payload');
  const messages = payload[field].map((message: unknown) => {
    if (!object(message) || message.role !== 'user') return message;
    const content = message[contentField];
    if (typeof content === 'string') {
      if (!byMarker.has(content) && !content.startsWith('[nomi-native-file:')) return message;
      return { ...message, [contentField]: [replace({ type: 'text', text: content })] };
    }
    if (!Array.isArray(content)) return message;
    return { ...message, [contentField]: content.map(replace) };
  });
  const rewritten = { ...payload, [field]: messages };
  if (files.some(file => nativeMediaKind(file.mimeType))) assertNativeRequestBodySize(JSON.stringify(rewritten));
  return { payload: rewritten, applied };
}
