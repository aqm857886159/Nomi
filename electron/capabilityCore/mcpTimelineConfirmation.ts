import type { ResultLocale } from './mcpToolResults'

// `nomi_timeline_edit` apply/undo is a reversible project write that an outside agent asks for, so it
// needs a human in the loop before it lands — exactly like `nomi_document_edit` (mcpDocumentConfirmation.ts)
// and batch canvas writes (mcpPlanTrust.ts). This module is that gate.
//
// Why it had to be added rather than merely fixed: `rpcServer.ts` already refused apply/undo unless the
// request carried `planConfirmed: true`, but nothing in the protocol layer ever set that flag for
// timeline.write — it was only ever minted for `canvas.write / create_canvas_nodes`. Combined with
// `timeline:write` being absent from every project-session scope grant, the tool could preview an edit
// and then never apply it, from any client, ever. Two independently unreachable gates in front of a
// tool that is advertised in `tools/list` and whose preview works: the user's agent proposes a change,
// shows them the diff, and then dies on "Project lease scope is insufficient".
//
// (Same shape as the 2026-09-03 finding where the client-confirmation surface was unreachable in
// production. The lesson repeats: "the client supports it" and "our side can reach it" are two separate
// facts and both have to be checked.)
//
// Copy is authored here rather than through desktopT for the capabilityCore reason (cf.
// mcpCredentialElicitation.ts): electron/i18n.ts value-imports `electron`, which the bare-Node MCP
// launcher's import closure forbids.

type TimelineConfirmation = {
  supported: boolean
  confirmed?: boolean
  action?: 'accept' | 'decline' | 'cancel' | 'timeout'
}

type TimelineConfirmationDependencies = {
  elicitBooleanConfirm: (input: { message: string; title: string; description: string }, signal?: AbortSignal) => Promise<TimelineConfirmation>
  invokeForRequest: (method: string, params: Record<string, unknown>, options?: { planConfirmed?: boolean }) => Promise<unknown>
  reply: (id: unknown, result: unknown) => void
  buildToolResultPayload: (toolName: string, args: Record<string, unknown>, result: unknown) => Record<string, unknown>
  locale: () => ResultLocale
}

/** Only apply/undo change the timeline; `preview` is read-shaped and needs no approval. */
function timelineWriteOperation(built: Record<string, unknown>): 'apply' | 'undo' | null {
  return built.operation === 'apply' || built.operation === 'undo' ? built.operation : null
}

const COPY = {
  ask: (operation: 'apply' | 'undo') => operation === 'apply'
    ? {
      message: '把这次时间轴改动应用到当前项目？改完可以撤销，不花额度。',
      title: '确认改时间轴',
      description: 'Approve to apply the previewed timeline edit plan. It is reversible and costs no quota; decline or timeout leaves the timeline unchanged.',
    }
    : {
      message: '撤销上一次时间轴改动？',
      title: '确认撤销时间轴改动',
      description: 'Approve to undo the last timeline edit. Decline or timeout leaves the timeline unchanged.',
    },
  unsupported: (locale: ResultLocale) => locale === 'en'
    ? 'Not applied: your AI client cannot ask you to confirm, and Nomi will not change the timeline without a human approval. Open Nomi and apply the previewed edit there, or use a client that supports MCP elicitation.'
    : '未生效：你的 AI 客户端没法向你征求确认，Nomi 不会在没有真人批准的情况下改时间轴。请回 Nomi 里应用刚才预览的改动，或换一个支持 MCP elicitation 的客户端。',
  denied: (locale: ResultLocale) => locale === 'en'
    ? 'Not applied: the timeline change was not approved.'
    : '未生效：这次时间轴修改没有获得批准。',
}

/**
 * Returns `true` when it has already replied (approved-and-invoked, denied, or unsupported) and the
 * caller must stop; `false` when this request is not a timeline write and should follow the normal path.
 */
export async function handleTimelineEditConfirmation(
  input: Readonly<{
    id: unknown
    toolName: string
    args: Record<string, unknown>
    routedMethod: string
    built: Record<string, unknown>
    requestSignal?: AbortSignal
  }>,
  dependencies: TimelineConfirmationDependencies,
): Promise<boolean> {
  if (input.toolName !== 'nomi_timeline_edit') return false
  const operation = timelineWriteOperation(input.built)
  if (!operation) return false

  const confirm = await dependencies.elicitBooleanConfirm(COPY.ask(operation), input.requestSignal)
  if (!confirm.supported || !confirm.confirmed) {
    const unsupported = !confirm.supported
    dependencies.reply(input.id, {
      content: [{
        type: 'text',
        text: unsupported ? COPY.unsupported(dependencies.locale()) : COPY.denied(dependencies.locale()),
      }],
      isError: true,
      structuredContent: {
        nomiOutcome: {
          operation: `timeline.${operation}`,
          applied: false,
          denied: true,
          reason: unsupported ? 'client_cannot_confirm' : confirm.action === 'timeout' ? 'timeout' : 'declined',
        },
      },
    })
    return true
  }

  const result = await dependencies.invokeForRequest(input.routedMethod, input.built, { planConfirmed: true })
  dependencies.reply(input.id, dependencies.buildToolResultPayload(input.toolName, input.args, result))
  return true
}
