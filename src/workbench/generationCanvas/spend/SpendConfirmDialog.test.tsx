import i18n from '../../../i18n'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { SpendConfirmDialog } from './SpendConfirmDialog'
import { confirmGenerationResend, useSpendConfirmStore } from './spendConfirm'
it('G1: the real spend shell preserves the two risk lines and explicit decision buttons', async () => {
 const decision=confirmGenerationResend({kind:'image',resultUnknown:true})
 const server=useSpendConfirmStore.getInitialState(),saved=server.pending
 server.pending=useSpendConfirmStore.getState().pending
 try {
  const html=renderToStaticMarkup(<MantineProvider env="test"><SpendConfirmDialog /></MantineProvider>)
  expect(html).toContain('whitespace-pre-line');expect(html).toContain(i18n.t('generationCommon.spend.resend.unknown'))
  expect(html).toContain('data-spend-confirm-action="cancel"');expect(html).toContain('data-spend-confirm-action="confirm"')
 } finally { server.pending=saved;useSpendConfirmStore.getState().resolvePending(false);await decision }
})
it('G2: Agent 发起的卡，对话框的名字只是标题（副标不并进名字里），副标看得见、紧跟名字', async () => {
 const title='在画布落一套方案（测试标题）'
 const decision=useSpendConfirmStore.getState().requestConfirm({title,message:'测试正文',source:'agent',kind:'plan'})
 const server=useSpendConfirmStore.getInitialState(),saved=server.pending
 server.pending=useSpendConfirmStore.getState().pending
 try {
  const html=renderToStaticMarkup(<MantineProvider env="test"><SpendConfirmDialog /></MantineProvider>)
  const notice=i18n.t('generationCommon.spend.agentNoticePlan')
  // 对话框的名字来自外壳给的标题元素（Mantine 的 aria-labelledby 指向 h2）：h2 里只有标题一句，不靠 aria-label 顶替。
  const heading=/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(html)
  expect(heading?.[1]).toBe(title)
  expect(heading?.[0]).not.toContain('aria-label')
  // 副标在标题栏里、名字后面，看得见（不藏给读屏、也不另抄一份 sr-only）
  const after=html.slice(html.indexOf('</h2>'))
  expect(after).toMatch(new RegExp(`<span class="[^"]*text-micro[^"]*">${notice}</span>`))
  expect(html).not.toContain('aria-hidden="true" class="block text-micro')
  expect(html).not.toContain('sr-only')
 } finally { server.pending=saved;useSpendConfirmStore.getState().resolvePending(false);await decision }
})
