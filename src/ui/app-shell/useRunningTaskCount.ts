import { useGenerationCanvasStore } from '../../workbench/generationCanvas/store/generationCanvasStore'
import { useProductionRunStore } from '../../workbench/production/productionRunStore'

/**
 * 现在有几个任务在跑：画布上排队 / 生成中的节点数 + 正在跑 / 暂停中 / 导出中的制作流程各算一个。
 * 更新弹窗据此决定能不能给「重启以更新」——有任务在跑时只说明「退出时自动装」，不让重启打断。
 */
export function useRunningTaskCount(): number {
  const runningNodes = useGenerationCanvasStore((state) => state.nodes.filter((node) => node.status === 'running' || node.status === 'queued').length)
  const productionActive = useProductionRunStore((state) => {
    const status = state.run?.status
    return status === 'running' || status === 'pausing' || status === 'exporting'
  })
  return runningNodes + (productionActive ? 1 : 0)
}
