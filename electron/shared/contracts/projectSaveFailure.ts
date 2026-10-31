import { WORKSPACE_MANIFEST_BUSY_ERROR_NAME } from './workspaceBusy'

export const PROJECT_SAVE_REASONS = ['workspace-busy', 'binding-stale', 'write-denied', 'in-use', 'disk-full', 'not-found', 'unknown'] as const
export type ProjectSaveReason = typeof PROJECT_SAVE_REASONS[number]
const SYSTEM_REASON = {
  EPERM: 'write-denied', EACCES: 'write-denied', EBUSY: 'in-use', ENOSPC: 'disk-full', ENOENT: 'not-found',
} as const satisfies Record<string, ProjectSaveReason>
type SystemCode = keyof typeof SYSTEM_REASON
const SYSCALLS = ['open', 'write', 'writeFile', 'rename', 'mkdir', 'read', 'readFile', 'stat', 'lstat', 'realpath', 'unlink', 'fsync', 'close', 'copyfile', 'access'] as const
export type ProjectSaveFailure = Readonly<{
  kind: ProjectSaveReason
  code: SystemCode | null
  errno: number | null
  syscall: typeof SYSCALLS[number] | null
  stage: 'authorize' | 'save-project'
}>

/** Called where the original main-process error still exists, before Electron loses its fields. */
export function projectSaveFailure(error: unknown, stage: ProjectSaveFailure['stage']): ProjectSaveFailure {
  const e = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = typeof e.code === 'string' && Object.prototype.hasOwnProperty.call(SYSTEM_REASON, e.code) ? e.code as SystemCode : null
  const kind = e.name === WORKSPACE_MANIFEST_BUSY_ERROR_NAME ? 'workspace-busy'
    : e.message === 'project_binding_stale' ? 'binding-stale'
    : code ? SYSTEM_REASON[code] : 'unknown'
  return {
    kind, code,
    errno: typeof e.errno === 'number' && Number.isSafeInteger(e.errno) ? e.errno : null,
    syscall: typeof e.syscall === 'string' && (SYSCALLS as readonly string[]).includes(e.syscall) ? e.syscall as ProjectSaveFailure['syscall'] : null,
    stage,
  }
}

/** Read only the typed data envelope; the save channel never needs message parsing. */
export function projectSaveReason(error: unknown): ProjectSaveReason | null {
  const reason = error && typeof error === 'object' ? (error as { reason?: unknown }).reason : null
  const kind = reason && typeof reason === 'object' ? (reason as { kind?: unknown }).kind : null
  return typeof kind === 'string' && (PROJECT_SAVE_REASONS as readonly string[]).includes(kind) ? kind as ProjectSaveReason : null
}
