import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import i18n from '../../../i18n'
import { NodeRecoverableReport } from '../nodes/NodeRecoverableReport'
import { recoverableCopyKeys, recoverableHintKey } from './recoverableCopy'

const unretrievedNode = { runs: [{ id: 'production-run-1:shot-1', status: 'recoverable', startedAt: 1 }] } as never
const timedOutNode = { runs: [{ id: 'run-abc', status: 'recoverable', startedAt: 1 }] } as never

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
