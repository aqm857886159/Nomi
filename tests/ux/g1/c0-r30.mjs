// C0 has one explicit planner attempt. Automatic media reviews are a separate population.
export function scorePlanner(events, domainComplete) {
  const first = events.find((e) => e.type === 'agent.tool.proposed')
  const completed = first && events.find((e) => e.type === 'agent.tool.completed'
    && e.payload?.toolCallId === first.payload?.toolCallId)
  const terminal = events.findLast((e) => e.type === 'agent.turn.finished' || e.type === 'agent.turn.error')
  const correct = completed?.payload?.ok === true
  const success = domainComplete && terminal?.type === 'agent.turn.finished'
    && terminal.payload?.status === 'ok' && Boolean(terminal.payload.finalTextHead?.trim())
  return { firstTool: first ? `${correct ? 1 : 0}/1 (${correct ? 100 : 0}%)` : 'N/A (0/0)',
    turns: `${success ? 1 : 0}/1 (${success ? 100 : 0}%)`,
    scope: 'One storyboard planner attempt; automatic reviews excluded. Missing tool events remain N/A.' }
}
