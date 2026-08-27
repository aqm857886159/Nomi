// Public IPC observer only: no model loop, tool execution, project writes or history ownership.
// Keep this function self-contained: Playwright serializes it into the renderer with win.evaluate.
// Tests may supply a fake public agents bridge as the second argument; real walks use the preload.
export async function runAgentProbe({ request, timeoutMs = 90_000 }, bridge = globalThis.window?.nomiDesktop?.agents) {
  const requestId = `probe-${globalThis.crypto.randomUUID()}`
  const seen = { requestId, ok: false, done: false, reason: null, result: null, text: '', calls: [], error: '', timedOut: false }
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe
    let timer
    let pendingDenials = 0
    let cancelSent = false
    const deniedIds = new Set()

    function recordError(message) {
      if (!settled) seen.error = seen.error ? `${seen.error}; ${message}` : message
    }

    function cancel(force = false) {
      if (cancelSent && !force) return
      cancelSent = true
      try {
        // Timeout must remain bounded even when the cancel IPC never acknowledges.
        void Promise.resolve(bridge.cancelChatV2(requestId)).catch((error) => {
          recordError(`Cancel failed: ${error?.message ?? error}`)
        })
      } catch (error) {
        recordError(`Cancel failed: ${error?.message ?? error}`)
      }
    }

    function complete() {
      if (settled) return
      if (seen.done && !seen.error) {
        if (!seen.result) recordError('Agent done without a result')
        else if (seen.reason !== 'finished' || seen.result.status !== 'finished') {
          recordError(`Agent completed with status ${seen.result.status ?? seen.reason}`)
        }
      }
      clearTimeout(timer)
      try { unsubscribe?.() } catch (error) { recordError(`Unsubscribe failed: ${error?.message ?? error}`) }
      unsubscribe = undefined
      seen.ok = seen.done && seen.reason === 'finished' && seen.result?.status === 'finished' && !seen.error && !seen.timedOut
      settled = true
      resolve({ ...seen, calls: [...seen.calls] })
    }

    function completeWhenDone() {
      if (seen.done && pendingDenials === 0) complete()
    }

    function captureCall(event) {
      if (typeof event.toolCallId !== 'string' || !event.toolCallId
        || typeof event.toolName !== 'string' || !event.toolName || event.args === undefined) return false
      const call = { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args }
      const index = seen.calls.findIndex((item) => item.toolCallId === call.toolCallId)
      if (index < 0) seen.calls.push(call)
      else seen.calls[index] = call
      return true
    }

    function deny(event) {
      if (deniedIds.has(event.toolCallId)) return
      deniedIds.add(event.toolCallId)
      pendingDenials += 1
      const failed = (error) => {
        if (settled) return
        recordError(`Tool denial failed (${event.toolCallId}): ${error?.message ?? error}`)
        cancel()
      }
      const finished = () => { pendingDenials -= 1; completeWhenDone() }
      try {
        // An activity event is not a confirmation request. Only full pending calls are denied.
        const acknowledgment = bridge.confirmTool(requestId, event.toolCallId, {
          ok: false, denied: true, message: 'probe: capture only; reject tool execution',
        })
        void Promise.resolve(acknowledgment).then((ack) => {
          if (ack?.ok !== true) failed(ack?.error ?? 'missing denial acknowledgment')
        }, failed).then(finished)
      } catch (error) {
        failed(error)
        finished()
      }
    }

    function onEvent(event) {
      if (settled || !event) return
      if (event.type === 'content-delta') seen.text += typeof event.delta === 'string' ? event.delta : ''
      if (event.type === 'tool-call' || event.type === 'tool-call-pending') {
        const completeCall = captureCall(event)
        if (completeCall && event.type === 'tool-call-pending') deny(event)
      }
      if (event.type === 'error') recordError(event.message || 'Unknown Agent error')
      if (event.type === 'result') {
        // Preserve the actual response, including usage and text on error. Never fabricate a result.
        seen.result = event.result ?? null
        if (typeof event.result?.text === 'string') seen.text = event.result.text
      }
      if (event.type === 'done') {
        seen.done = true
        seen.reason = event.reason
        completeWhenDone()
      }
    }

    function startFailed(error) {
      if (settled) return
      recordError(`Agent start failed: ${error?.message ?? error}`)
      cancel()
      complete()
    }

    try {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Probe timeoutMs must be positive')
      timer = setTimeout(() => {
        seen.timedOut = true
        recordError(`Agent probe timeout after ${timeoutMs}ms; cancelling ${requestId}`)
        cancel()
        complete()
      }, timeoutMs)
      unsubscribe = bridge.onChatV2Event(requestId, onEvent)
      if (settled) { unsubscribe?.(); unsubscribe = undefined; return }
      // The renderer chooses the request id, so neither events nor cancellation wait for this ACK.
      void Promise.resolve(bridge.chatV2Start({ requestId, request })).then((ack) => {
        if (seen.timedOut) { cancel(true); return }
        if (settled) return
        if (ack?.sessionId !== requestId) startFailed(new Error('Agent start acknowledged a different request id'))
      }, startFailed)
    } catch (error) {
      startFailed(error)
    }
  })
}
