// Compatibility API for existing PDF consumers; all native files share one serializer.
import { rewriteNativeFilePayload } from './nativeFilePayload';
export type NativePdf = { marker: string; fileName: string; data: string };
export function assertPdfProtocol(api: string | undefined): void {
  if (api !== 'anthropic-messages' && api !== 'openai-responses' && api !== 'google-generative-ai') {
    throw new Error(`Native PDF is unsupported for ${api ?? 'no model'}`);
  }
}
export function rewritePdfPayload(payload: unknown, api: string, files: readonly NativePdf[]) {
  if (files.length) assertPdfProtocol(api);
  return rewriteNativeFilePayload(payload, api, files.map(file => ({ ...file, type: 'file' as const, mimeType: 'application/pdf' })));
}

export function injectPdfPayload(payload: unknown, api: string, files: readonly NativePdf[]): unknown {
  return rewritePdfPayload(payload, api, files).payload;
}
