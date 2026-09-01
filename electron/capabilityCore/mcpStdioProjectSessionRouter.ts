import type { McpConnectionContext } from './mcpConnectionContext'
import type { VerifiedProjectSessionBinding } from './projectSessionRuntime'

export type ProjectSessionBinding = VerifiedProjectSessionBinding

export type McpStdioProjectSessionRouterDeps<TInstance, TOptions> = Readonly<{
  projectSession: ProjectSessionBinding
  readLiveInstance: () => TInstance | null
  invokeViaRpc: (
    instance: TInstance,
    method: string,
    params: Record<string, unknown>,
    connection: McpConnectionContext,
    options: TOptions | undefined,
  ) => Promise<unknown>
  invokeDirect: (
    method: string,
    params: Record<string, unknown>,
    projectSession: ProjectSessionBinding,
    options: TOptions | undefined,
  ) => Promise<unknown>
}>

/**
 * Choose loopback or direct execution at request time while keeping the one
 * transport-minted project-session binding closed over both routes.
 */
export function createMcpStdioProjectSessionRouter<TInstance, TOptions = undefined>(
  deps: McpStdioProjectSessionRouterDeps<TInstance, TOptions>,
) {
  return (
    method: string,
    params: Record<string, unknown>,
    options?: TOptions,
  ): Promise<unknown> => {
    const instance = deps.readLiveInstance()
    return instance !== null
      ? deps.invokeViaRpc(instance, method, params, deps.projectSession.connection, options)
      : deps.invokeDirect(method, params, deps.projectSession, options)
  }
}
