import type { ProductionRun, RunCommand } from '../../../electron/productionRun/productionRunTypes'

type ProductionCommandResult = {
  run: ProductionRun
  events: unknown[]
}

type ProductionRunCommandDeps = {
  read: (projectId: string, runId: string) => Promise<ProductionRun | null>
  execute: (projectId: string, runId: string, command: RunCommand) => Promise<ProductionCommandResult>
}

function isRevisionConflict(error: unknown): boolean {
  return /productionrunrevisionconflict|production run revision conflict|revision[\s_-]*conflict/i.test(
    error instanceof Error ? error.message : String(error),
  )
}

/** Recover renderer commands from a concurrent durable Run update. */
export async function executeProductionRunCommand(
  projectId: string,
  runId: string,
  command: RunCommand,
  deps: ProductionRunCommandDeps,
): Promise<ProductionCommandResult> {
  try {
    return await deps.execute(projectId, runId, command)
  } catch (error) {
    if (!isRevisionConflict(error)) throw error

    const latest = await deps.read(projectId, runId)
    if (!latest) throw error

    if (command.type === 'gate.decide') {
      const gateId = typeof command.payload.gateId === 'string' ? command.payload.gateId : ''
      const gate = latest.gates.find((candidate) => candidate.gateId === gateId)
      // Another click/client may have completed the same gate while this
      // request was in flight. Treat that as success and refresh the panel.
      if (gate && gate.status !== 'waiting') return { run: latest, events: [] }
    }

    return deps.execute(projectId, runId, {
      ...command,
      expectedRevision: latest.revision,
    })
  }
}
