import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from '../../../i18n'
import { NodeRecoverableReport } from '../nodes/NodeRecoverableReport'
import { RETRIEVAL_UNAVAILABLE_MESSAGE } from '../../../../electron/shared/nomiErrorCodes'
import { recoverableCopyKeys, recoverableHintKey, unretrievedCopyKeys } from './recoverableCopy'

const unretrievedNode = { runs: [{ id: 'production-run-1:shot-1', status: 'recoverable', startedAt: 1 }] } as never
const timedOutNode = { runs: [{ id: 'run-abc', status: 'recoverable', startedAt: 1 }] } as never
// 和真实路径同形：错误经 IPC 过来时前面多一段，码还在。
const ipcWrapped = `Error invoking remote method 'nomi:canvas-shot:poll': Error: ${RETRIEVAL_UNAVAILABLE_MESSAGE}`

describe('recoverable copy: one sentence for node, shot table and task panel', () => {
  it('a node projected from an unretrieved production job speaks the task panel keys', () => {
    expect(recoverableCopyKeys(unretrievedNode)).toMatchObject({
      title: 'generationCommon.production.status.outputRetrievalFailed',
      description: 'generationCommon.production.description.outputRetrievalFailed',
    })
    expect(recoverableHintKey(unretrievedNode)).toBe('generationCommon.production.description.outputRetrievalFailed')
  })

  it('a node that merely timed out keeps the generic timeout copy', () => {
    expect(recoverableCopyKeys(timedOutNode).description).toBe('generationCommon.recoverable.description')
    expect(recoverableHintKey(timedOutNode)).toBe('storyboardEditor.frame.recoverableHint')
  })

  it('Nomi cannot ask right now: node, shot table and task panel all say the third sentence, whatever the run record is', () => {
    const description = 'generationCommon.recoverable.unavailableDescription'
    for (const runs of [(timedOutNode as { runs: unknown[] }).runs, (unretrievedNode as { runs: unknown[] }).runs]) {
      const node = { runs, error: ipcWrapped } as never
      expect(recoverableCopyKeys(node)).toMatchObject({ title: 'generationCommon.recoverable.unavailableTitle', description })
      expect(recoverableHintKey(node)).toBe(description)
    }
    expect(unretrievedCopyKeys(RETRIEVAL_UNAVAILABLE_MESSAGE).description).toBe(description)
    expect(unretrievedCopyKeys('NOMI_ERR::retrieval-query:: x').description).toBe('generationCommon.production.description.outputRetrievalFailed')
    expect(unretrievedCopyKeys(undefined).description).toBe('generationCommon.production.description.outputRetrievalFailed')
  })

  it('other retrieval failures keep their own sentences (the third one needs the code, not similar words)', () => {
    const lookalike = { runs: (timedOutNode as { runs: unknown[] }).runs, error: 'NOMI_ERR::retrieval-query:: the model or API key is unavailable right now' } as never
    expect(recoverableCopyKeys(lookalike).description).toBe('generationCommon.recoverable.description')
  })

  it.each(['zh-CN', 'en-US'])('the third sentence names the real buttons, and never claims the result exists (%s)', async (lng) => {
    await i18n.changeLanguage(lng)
    const node = { runs: (timedOutNode as { runs: unknown[] }).runs, error: ipcWrapped } as never
    const html = renderToStaticMarkup(React.createElement(NodeRecoverableReport, { node, onRecover: () => undefined, onDismiss: () => undefined }))
    const description = String(i18n.t('generationCommon.recoverable.unavailableDescription'))
    expect(html).toContain(`aria-label="${i18n.t('generationCommon.recoverable.unavailableTitle')}"`)
    expect(description).toContain(String(i18n.t('generationCommon.production.runAction.retry-retrieval')))
    expect(description).toContain(String(i18n.t('generationCommon.recoverable.dismiss')))
    expect(html).not.toContain(i18n.t('generationCommon.recoverable.description'))
    expect(html).not.toMatch(/已经生成|already generated/i)
    // 这句话是 Nomi 自己说的，不许印成「服务商原话」。
    expect(html).not.toContain(i18n.t('generationCommon.error.providerMessage'))
  })

  it.each(['zh-CN', 'en-US'])('the node panel renders the task panel sentence for an unretrieved shot (%s)', async (lng) => {
    await i18n.changeLanguage(lng)
    const html = renderToStaticMarkup(React.createElement(NodeRecoverableReport, { node: unretrievedNode }))
    expect(html).toContain(i18n.t('generationCommon.production.status.outputRetrievalFailed'))
    expect(html).toContain(i18n.t('generationCommon.production.description.outputRetrievalFailed'))
    expect(html).not.toContain(i18n.t('generationCommon.recoverable.description'))
  })

  it.each(['zh-CN', 'en-US'])('the node button carries the task panel button name, and the sentence names the same button (%s)', async (lng) => {
    await i18n.changeLanguage(lng)
    const label = i18n.t('generationCommon.production.runAction.retry-retrieval')
    const html = renderToStaticMarkup(React.createElement(NodeRecoverableReport, { node: unretrievedNode, onRecover: () => undefined }))
    expect(html).toContain(`aria-label="${label}"`)
    expect(i18n.t('generationCommon.recoverable.description')).toContain(label)
    expect(String(i18n.t('generationCommon.production.description.outputRetrievalFailed')).toLowerCase()).toContain(String(label).toLowerCase())
    expect(String(i18n.t('storyboardEditor.frame.recoverableHint')).toLowerCase()).toContain(String(label).toLowerCase())
  })
})
