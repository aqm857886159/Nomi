// Native PDF payload conversion; shared by lane and non-renderer provider integrations.
export type NativePdf = { marker: string; fileName: string; data: string };
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function assertPdfProtocol(api: string | undefined): void {
  if (api !== 'anthropic-messages' && api !== 'openai-responses' && api !== 'google-generative-ai') {
    throw new Error(`Native PDF is unsupported for ${api ?? 'no model'}`);
  }
}
export function rewritePdfPayload(payload: unknown, api: string, files: readonly NativePdf[]) {
  const applied = new Set<string>();
  if (!files.length) return { payload, applied };
  assertPdfProtocol(api);
  const byMarker = new Map(files.map((file) => [file.marker, file]));
  if (byMarker.size !== files.length) throw new Error('Duplicate native PDF marker');
  if (api === 'google-generative-ai') {
    if (!object(payload) || !Array.isArray(payload.contents)) throw new Error('Unexpected native PDF provider payload');
    const contents = payload.contents.map((item: unknown) => {
      if (!object(item) || item.role !== 'user' || !Array.isArray(item.parts)) return item;
      const parts = item.parts.map((part: unknown) => {
        if (!object(part) || typeof part.text !== 'string') return part;
        const file = byMarker.get(part.text);
        if (!file) return part;
        applied.add(file.marker);
        return { inlineData: { mimeType: 'application/pdf', data: file.data } };
      });
      return { ...item, parts };
    });
    return { payload: { ...payload, contents }, applied };
  }
  const filePart = (file: NativePdf) => api === 'anthropic-messages'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
    : { type: 'input_file', filename: file.fileName, file_data: `data:application/pdf;base64,${file.data}` };
  const rewritePart = (part: unknown): unknown => {
    if (!object(part) || (part.type !== 'text' && part.type !== 'input_text') || typeof part.text !== 'string') return part;
    const file = byMarker.get(part.text);
    if (!file) return part;
    applied.add(file.marker);
    return filePart(file);
  };
  const field = api === 'anthropic-messages' ? 'messages' : 'input';
  if (!object(payload) || !Array.isArray(payload[field])) throw new Error('Unexpected native PDF provider payload');
  const messages = payload[field].map((message: unknown) => {
    if (!object(message) || message.role !== 'user') return message;
    if (typeof message.content === 'string' && byMarker.has(message.content)) {
      const file = byMarker.get(message.content)!;
      applied.add(file.marker);
      return { ...message, content: [filePart(file)] };
    }
    if (!Array.isArray(message.content)) return message;
    return { ...message, content: message.content.map(rewritePart) };
  });
  return { payload: { ...payload, [field]: messages }, applied };
}

export function injectPdfPayload(payload: unknown, api: string, files: readonly NativePdf[]): unknown {
  return rewritePdfPayload(payload, api, files).payload;
}
