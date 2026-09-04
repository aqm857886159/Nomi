import type { ResultLocale } from './mcpToolResults'

type DocumentConfirmation = {
  supported: boolean
  confirmed?: boolean
  action?: 'accept' | 'decline' | 'cancel' | 'timeout'
}

type DocumentConfirmationDependencies = {
  elicitBooleanConfirm: (input: { message: string; title: string; description: string }, signal?: AbortSignal) => Promise<DocumentConfirmation>
  invokeForRequest: (method: string, params: Record<string, unknown>, options?: { documentConfirmed?: boolean }) => Promise<unknown>
  reply: (id: unknown, result: unknown) => void
  buildToolResultPayload: (toolName: string, args: Record<string, unknown>, result: unknown) => Record<string, unknown>
  locale: () => ResultLocale
}

export async function handleDocumentEditConfirmation(
  input: Readonly<{ id: unknown; args: Record<string, unknown>; routedMethod: string; built: Record<string, unknown>; requestSignal?: AbortSignal }>,
  dependencies: DocumentConfirmationDependencies,
): Promise<void> {
  const confirm = await dependencies.elicitBooleanConfirm({
    message: 'Apply this document change? The operation is reversible and will update the current project document.',
    title: 'Confirm document change',
    description: 'Approve to write the requested content. Decline or timeout leaves the document and receipt unchanged.',
  }, input.requestSignal)
  if (!confirm.supported || !confirm.confirmed) {
    dependencies.reply(input.id, {
      content: [{
        type: 'text',
        text: dependencies.locale() === 'en'
          ? 'Not applied: the document change was not approved.'
          : '未生效：这次文稿修改没有获得批准。',
      }],
      isError: true,
      structuredContent: {
        nomiOutcome: {
          operation: 'document.write',
          applied: false,
          denied: true,
          reason: confirm.action === 'timeout' ? 'timeout' : 'declined',
        },
      },
    })
    return
  }
  const result = await dependencies.invokeForRequest(input.routedMethod, input.built, { documentConfirmed: true })
  dependencies.reply(input.id, dependencies.buildToolResultPayload('nomi_document_edit', input.args, result))
}
