// 「生成时可调参数」候选池：全部标量 widget 减掉**当前**已被角色占用的那些（纯函数，可测）。
//
// 为什么要现算、而不是分析时算一次（用户 2026-08-03 报一次、2026-08-11 又报一次的根因）：
// 一个输入既当提示词又当可调参数时，导入阶段参数占位会覆盖掉 {{request.prompt}}——
// 用户在输入框里打的提示词根本送不进 ComfyUI，画面上还看不出任何异常（详见
// electron/catalog/comfyuiWorkflowImport.ts 的 roleBoundInputKeys）。
// 所以排除是必须的；但「排除谁」取决于**用户此刻选的绑定**，不是分析那一刻的自动建议：
// 自动认错时用户会自己改提示词节点，那一刻新选中的必须立刻从参数池里消失、
// 原先被排除的那个必须回来。钉死在建议上就是原来那个 bug 的形状。
//
// 与 electron 侧 roleBoundInputKeys 同源同义：这里管「别摆出来」（体验），
// 那里管「摆出来了也不许生效」（correctness 兜底）。IPC 两侧各一份是本模块既有的镜像约定
// （见 ComfyuiWorkflowImportPanel.tsx 的 Binding 镜像注释），改一侧必须同步另一侧。

/** 会占用某个节点输入的四个角色（与 electron 侧 WorkflowBinding 的角色字段一一对应）。 */
export type RoleBinding = {
  promptNodeId?: string
  promptInputKey?: string
  firstFrameNodeId?: string
  firstFrameInputKey?: string
  lastFrameNodeId?: string
  lastFrameInputKey?: string
  sourceVideoNodeId?: string
  sourceVideoInputKey?: string
}

export type InputRef = { nodeId: string; inputKey: string }

const refKey = (nodeId: string, inputKey: string): string => `${nodeId} ${inputKey}`

/** 当前绑定里被角色占用的输入集合。 */
export function roleBoundInputKeys(binding: RoleBinding | null | undefined): Set<string> {
  const keys = new Set<string>()
  if (!binding) return keys
  const roles: Array<[string | undefined, string | undefined]> = [
    [binding.promptNodeId, binding.promptInputKey],
    [binding.firstFrameNodeId, binding.firstFrameInputKey],
    [binding.lastFrameNodeId, binding.lastFrameInputKey],
    [binding.sourceVideoNodeId, binding.sourceVideoInputKey],
  ]
  for (const [nodeId, inputKey] of roles) {
    if (nodeId && inputKey) keys.add(refKey(nodeId, inputKey))
  }
  return keys
}

/** 可当「生成时可调参数」的候选（泛型：调用方的候选类型只要带 nodeId/inputKey 即可）。 */
export function paramCandidates<T extends InputRef>(all: readonly T[], binding: RoleBinding | null | undefined): T[] {
  const bound = roleBoundInputKeys(binding)
  return all.filter((c) => !bound.has(refKey(c.nodeId, c.inputKey)))
}
