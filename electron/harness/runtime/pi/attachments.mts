import { randomUUID } from 'node:crypto';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Api } from '@earendil-works/pi-ai';
import { z } from 'zod';

export type NativePdf = { marker: string; fileName: string; data: string };
const customType = 'nomi.native-pdf.v1';
const filesSchema = z.object({ files: z.array(z.object({
  marker: z.string().min(1), fileName: z.string().min(1),
  data: z.string().min(1).regex(/^[A-Za-z0-9+/]+={0,2}$/),
})) });
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertSupported(api: Api | undefined): void {
  if (api !== 'anthropic-messages' && api !== 'openai-responses') {
    throw new Error(`Native PDF is unsupported for ${api ?? 'no model'}`);
  }
}
function rewrite(payload: unknown, api: Api, files: readonly NativePdf[]) {
  const applied = new Set<string>();
  if (!files.length) return { payload, applied };
  assertSupported(api);
  const byMarker = new Map(files.map((file) => [file.marker, file]));
  if (byMarker.size !== files.length) throw new Error('Duplicate native PDF marker');
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

export function injectPdfPayload(payload: unknown, api: Api, files: readonly NativePdf[]): unknown {
  return rewrite(payload, api, files).payload;
}

// Pi's public messages have text/image but no file part. Store a typed custom
// message with a unique token; replace only that user content at the official
// onPayload boundary. Bytes never masquerade as an image or extracted text.
export async function addPdfContext(session: AgentSession, files: ReadonlyArray<{ fileName: string; data: Uint8Array }>): Promise<void> {
  if (!files.length) return;
  if (!session.isIdle || session.isCompacting) throw new Error('PDF context requires an idle session');
  assertSupported(session.model?.api);
  const nativeFiles = filesSchema.parse({ files: files.map((file) => ({
    marker: `[nomi-pdf:${randomUUID()}]`, fileName: file.fileName,
    data: Buffer.from(file.data).toString('base64'),
  })) }).files;
  await session.sendCustomMessage({ customType,
    content: nativeFiles.map((file) => ({ type: 'text', text: file.marker })),
    display: false, details: { files: nativeFiles },
  }, { triggerTurn: false });
}

export function installNativePdfBridge(session: AgentSession): () => void {
  const previous = session.agent.streamFunction;
  const wrapper: typeof previous = (model, context, options) => {
    const allFiles = session.sessionManager.getBranch().flatMap((entry) => {
      if (entry.type !== 'custom_message' || entry.customType !== customType) return [];
      return filesSchema.parse(entry.details).files;
    });
    // Compaction intentionally summarizes old messages. Do not revive files
    // absent from the current request or pull attachments from another branch.
    const userTexts = new Set(context.messages.flatMap((message) => {
      if (message.role !== 'user') return [];
      if (typeof message.content === 'string') return [message.content];
      return message.content.filter((part) => part.type === 'text').map((part) => part.text);
    }));
    const files = allFiles.filter((file) => userTexts.has(file.marker));
    return previous(model, context, { ...options,
      onPayload: async (payload, requestedModel) => {
        const transformed = await options?.onPayload?.(payload, requestedModel);
        const result = rewrite(transformed ?? payload, requestedModel.api, files);
        if (files.some((file) => !result.applied.has(file.marker))) {
          throw new Error('Native PDF was not preserved by the provider payload adapter');
        }
        return result.payload;
      },
    });
  };
  session.agent.streamFunction = wrapper;
  return () => { if (session.agent.streamFunction === wrapper) session.agent.streamFunction = previous; };
}
