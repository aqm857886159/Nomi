// 能力核 · 方法路由（单一真相源）。
// RPC 传输（rpcServer）与 headless host（host）共用这一份 method→core 映射，杜绝两份路由漂移（P1）。
import {
  addProjectNodes,
  connectProjectNodes,
  createNamedProject,
  deleteProjectNodes,
  generateOnProject,
  listAllProjects,
  listAvailableModels,
  readProjectCanvas,
  setProjectNodePrompt,
  type FetchTaskResultFn,
  type GenerateInput,
  type RunTaskFn,
} from './core'

/** 会改盘的方法——app 开着时对「正在打开的项目」要拒绝（A/B 守卫，见 rpcServer）。 */
export const MUTATION_METHODS = new Set([
  'canvas.addNodes',
  'canvas.connect',
  'canvas.setPrompt',
  'canvas.deleteNodes',
])

export class RpcError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message)
  }
}

export function projectIdOf(params: Record<string, unknown>): string {
  return typeof params.projectId === 'string' ? params.projectId : ''
}

export type DispatchContext = { runTask: RunTaskFn; fetchTaskResult?: FetchTaskResultFn }

export async function dispatch(method: string, params: Record<string, unknown>, ctx: DispatchContext): Promise<unknown> {
  switch (method) {
    case 'ping':
      return { ok: true }
    case 'project.list':
      return { projects: listAllProjects() }
    case 'project.create':
      return createNamedProject(typeof params.name === 'string' ? params.name : undefined)
    case 'models.list':
      return { models: listAvailableModels() }
    case 'canvas.read':
      return readProjectCanvas(projectIdOf(params))
    case 'canvas.addNodes':
      return addProjectNodes(projectIdOf(params), Array.isArray(params.nodes) ? (params.nodes as never[]) : [])
    case 'canvas.connect':
      return connectProjectNodes(projectIdOf(params), Array.isArray(params.connections) ? (params.connections as never[]) : [])
    case 'canvas.setPrompt':
      return setProjectNodePrompt(
        projectIdOf(params),
        String(params.nodeId || ''),
        String(params.prompt || ''),
        typeof params.title === 'string' ? params.title : undefined,
      )
    case 'canvas.deleteNodes':
      return deleteProjectNodes(projectIdOf(params), Array.isArray(params.nodeIds) ? (params.nodeIds as string[]) : [])
    case 'generate':
      return generateOnProject(params as unknown as GenerateInput, ctx.runTask, ctx.fetchTaskResult)
    default:
      throw new RpcError(`未知方法: ${method}`, 404)
  }
}
