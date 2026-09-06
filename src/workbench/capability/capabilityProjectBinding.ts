import i18n from '../../i18n'

/**
 * MCP 能力路由的**项目身份**边界（单一定义处）。
 *
 * 背景（2026-09-06 根因，`docs/fixes/2026-09-06-mcp-lease-project-binding.root-cause.json`）：
 * 主进程在校验 project-session lease 之后，已经把 `lease.projectId` 放进发往渲染层的 payload
 * （`electron/capabilityCore/rpcServer.ts` 的 rendererPayload）。但渲染层这一族适配器把它丢了，
 * 转头去读「GUI 当前打开的项目」——于是外部宿主只能操作「人正好开着的那个项目」，它自己刚建的
 * 项目一律 `project_scope_required`，而且这句错误没有下一步。
 *
 * 这一族按**面**分两类，处置不同（同一条 lease，两种物理可能性）：
 *
 * · **可寻址面**（`asset.read` / `export.read`）——底下是主进程按 projectId 寻址的 store
 *   （素材库、导出作业登记）。项目开不开着都能答，所以直接用 lease 的 projectId，
 *   与 GUI 当前打开哪个项目**完全无关**。
 *
 * · **实时面**（`timeline.read` / `timeline.write`）——真相在**打开的那个项目**的渲染层 store 里
 *   （未落盘的编辑、撤销栈、revision）。对别的项目执行只能改到一份陈旧的盘上副本，同时把人正在
 *   编辑的那份甩开——比报错更糟。所以一律拒（**没打开任何项目也算不匹配**），但错误必须
 *   **点名两个项目 + 给下一步**，不是没有下一步的 `project_scope_required`。
 *
 * `document.write` / `layout.*` 不在这两个名单里：它们不读「当前项目」，读的是 activeDocumentId /
 * editingPanelLayout，跟本次根因不同族，继续走 capabilityApplyHandler 里那道通用的「目标≠活动 → 拒」。
 */
export const MCP_PROJECT_ADDRESSABLE_CAPABILITY_OPS: ReadonlySet<string> = new Set([
  'asset.read',
  'export.read',
])

export const MCP_REALTIME_SURFACE_CAPABILITY_OPS: ReadonlySet<string> = new Set([
  'timeline.read',
  'timeline.write',
])

/** 点名 lease 绑的项目、现在打开的项目和下一步——不是裸 `project_scope_required`。 */
export function capabilityProjectBindingError(leaseProjectId: string, openProjectId: string | null): Error {
  const error = new Error(i18n.t('runtime.capability.projectBindingMismatch', {
    leaseProject: leaseProjectId,
    openProject: openProjectId || i18n.t('runtime.capability.noProjectOpen'),
  })) as Error & { code?: string }
  error.code = 'project_binding_mismatch'
  return error
}

/**
 * 项目身份的唯一解析处：**显式（已校验的 lease）优先**，没给才回退到 GUI 当前项目。
 *
 * 回退这一支只服务应用内 Agent / Surface 端口的调用者——它们按定义就只操作打开的那个项目，
 * 手上没有 lease。MCP 路一定带 projectId（rpcServer 在 lease 校验后铸的），走不到回退。
 */
export function resolveCapabilityProjectId(
  explicitProjectId: unknown,
  readOpenProjectId: () => string,
  missingProjectMessage: string,
): string {
  const explicit = typeof explicitProjectId === 'string' ? explicitProjectId.trim() : ''
  const projectId = explicit || readOpenProjectId().trim()
  if (!projectId) throw new Error(missingProjectMessage)
  return projectId
}
