// 「已提交、没取回」那一类错误卡的主按钮按任务来源分（⑬，协调 10-22）：
// 画布任务回到可找回面板「去重新取回」；制作 Run 保留「查看制作任务」。画布任务上写「查看制作任务」会误导。
import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n from '../../../i18n'
import { tagNomiError } from '../../../../electron/shared/nomiErrorCodes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { reopenRecoverableNode } from '../runner/recoverTaskActions'
import { NodeErrorReport } from './NodeErrorReport'

const RETRIEVAL_FAILURE = tagNomiError('retrieval-query', '取回卡在「查询任务」这一步：socket hang up')

function canvasNode(taskId?: string): string {
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({ kind: 'video', prompt: '镜头 1', meta: { modelVendor: 'apimart', modelKey: 'video-model' } })
  store.appendNodeRun(node.id, { id: 'run-1', status: 'running', startedAt: 1, updatedAt: 1, ...(taskId ? { taskId } : {}) })
  store.setNodeStatus(node.id, 'error', RETRIEVAL_FAILURE)
  return node.id
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
})

describe('「已提交、没取回」错误卡的主按钮按任务来源分', () => {
  for (const lang of ['zh-CN', 'en'] as const) {
    it(`${lang} · 画布任务（有 taskId）：主按钮是「去重新取回」，不是「查看制作任务」`, async () => {
      await i18n.changeLanguage(lang)
      const nodeId = canvasNode('task-paid-1')
      const markup = renderToStaticMarkup(<NodeErrorReport message={RETRIEVAL_FAILURE} nodeId={nodeId} run={{ id: 'run-1', taskId: 'task-paid-1' }} meta={{}} onRetry={() => {}} />)
      expect(markup).toContain(i18n.t('generationCommon.observability.action.openRecoverable.main'))
      expect(markup).not.toContain(i18n.t('generationCommon.observability.action.viewTask.main'))
    })
  }

  // 0.24.0 及更早存在节点上的两句旧话：钱已经花了、任务号还在，主按钮不能是重试（= 再扣一次）。
  for (const lang of ['zh-CN', 'en'] as const) {
    for (const sentence of ['生成结果未能安全落入项目，请查看任务并处理', '供应商返回了未识别的任务状态，需要人工核对']) {
      it(`${lang} · 老项目的错误卡「${sentence}」：主按钮是去重新取回`, async () => {
        await i18n.changeLanguage(lang)
        const nodeId = canvasNode('task-paid-old')
        const markup = renderToStaticMarkup(<NodeErrorReport message={sentence} nodeId={nodeId} run={{ id: 'run-1', taskId: 'task-paid-old' }} meta={{}} onRetry={() => {}} />)
        expect(markup).toContain(i18n.t('generationCommon.observability.action.openRecoverable.main'))
        expect(markup).not.toContain(`>${i18n.t('generationCommon.observability.action.retry.main')}<`)
      })
    }
  }

  it('制作 Run 的镜：保留「查看制作任务」', () => {
    const nodeId = canvasNode('task-paid-2')
    const markup = renderToStaticMarkup(<NodeErrorReport message={RETRIEVAL_FAILURE} nodeId={nodeId} run={{ id: 'run-2', taskId: 'task-paid-2' }} meta={{ productionRunId: 'run-x', productionShotId: 's1' }} onRetry={() => {}} />)
    expect(markup).toContain(i18n.t('generationCommon.observability.action.viewTask.main'))
    expect(markup).not.toContain(i18n.t('generationCommon.observability.action.openRecoverable.main'))
  })

  // 同步供应商（2026-10-28）：结果只在创建请求的那一次回答里，节点上没有任务号——没有东西可以再查、再取。
  // 卡上不许出现任何暗示能取回的说明或动作：主动作是重试（= 重新生成），说明换成「没有可以再查的任务」那一版。
  for (const lang of ['zh-CN', 'en'] as const) {
    it(`${lang} · 画布任务没有 taskId：主按钮是重试，说明与按钮都不提重新取回 / 查看任务`, async () => {
      await i18n.changeLanguage(lang)
      const nodeId = canvasNode()
      const markup = renderToStaticMarkup(<NodeErrorReport message={tagNomiError('retrieval-download', 'Fetch failed: HTTP 403')} nodeId={nodeId} run={{ id: 'run-1' }} meta={{}} onRetry={() => {}} />)
      expect(markup).toContain(i18n.t('generationCommon.observability.action.retry.main'))
      expect(markup).toContain(i18n.t('generationCommon.observability.error.retrievalIncomplete.hintWithoutTask'))
      expect(markup).not.toContain(i18n.t('generationCommon.production.runAction.retry-retrieval'))
      expect(markup).not.toContain(i18n.t('generationCommon.observability.action.openRecoverable.main'))
      expect(markup).not.toContain(i18n.t('generationCommon.observability.action.viewTask.main'))
    })
  }

  it('Agent 付费卡交给画布的那一镜（带制作链接、画布自己的运行记录、没有 taskId）：同样是重试，不领去任务中心', () => {
    const nodeId = canvasNode()
    const markup = renderToStaticMarkup(<NodeErrorReport message={RETRIEVAL_FAILURE} nodeId={nodeId} run={{ id: 'run-1' }} meta={{ productionRunId: 'run-x', productionShotId: 's1' }} onRetry={() => {}} />)
    expect(markup).toContain(i18n.t('generationCommon.observability.action.retry.main'))
    expect(markup).not.toContain(i18n.t('generationCommon.observability.action.viewTask.main'))
  })

  it('制作投影写的记录（任务住在制作 Run 里，节点上本来就没有 taskId）：保留「查看制作任务」', () => {
    const nodeId = canvasNode()
    const markup = renderToStaticMarkup(<NodeErrorReport message={RETRIEVAL_FAILURE} nodeId={nodeId} run={{ id: 'production-job-1' }} meta={{ productionRunId: 'run-x', productionShotId: 's1' }} onRetry={() => {}} />)
    expect(markup).toContain(i18n.t('generationCommon.observability.action.viewTask.main'))
    expect(markup).not.toContain(i18n.t('generationCommon.observability.error.retrievalIncomplete.hintWithoutTask'))
  })

  it('取片被出网策略拦、没有 taskId：先去检查网络那一行，次动作重试；说明不提重新取回', () => {
    const nodeId = canvasNode()
    const markup = renderToStaticMarkup(<NodeErrorReport message={tagNomiError('outbound-blocked', 'blocked')} nodeId={nodeId} run={{ id: 'run-1' }} meta={{}} onRetry={() => {}} />)
    expect(markup).toContain(i18n.t('generationCommon.observability.action.modelAccess.main'))
    expect(markup).toContain(i18n.t('generationCommon.observability.action.retry.alt'))
    expect(markup).toContain(i18n.t('generationCommon.observability.error.outboundBlocked.hintWithoutTask'))
    expect(markup).not.toContain(i18n.t('generationCommon.production.runAction.retry-retrieval'))
  })

  it('点「去重新取回」：节点回到可找回态，错误原话留着（面板照样给技术详情）', () => {
    const nodeId = canvasNode('task-paid-3')
    expect(reopenRecoverableNode(nodeId)).toBe(true)
    expect(useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)).toMatchObject({ status: 'recoverable', error: RETRIEVAL_FAILURE })
    expect(reopenRecoverableNode(canvasNode())).toBe(false)
  })
})


it.each(['zh-CN', 'en'])('C1: %s canvas submission unknown exposes the existing release confirmation', async lang => {
  await i18n.changeLanguage(lang)
  const markup = renderToStaticMarkup(<NodeErrorReport message={tagNomiError('submission-unknown', 'not confirmed')} nodeId="canvas-node" run={{ id: 'canvas-record' }} meta={{}} onRetry={() => {}} />)
  expect(markup).toContain(renderToStaticMarkup(<span>{i18n.t('generationCommon.observability.action.releaseRegenerate.alt')}</span>).slice(6, -7))
})
