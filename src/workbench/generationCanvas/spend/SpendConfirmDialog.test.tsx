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
it('G2: Agent 发起的卡，对话框的名字只是标题（副标不并进名字里），副标仍读得到', async () => {
 const title='在画布落一套方案（测试标题）'
 const decision=useSpendConfirmStore.getState().requestConfirm({title,message:'测试正文',source:'agent',kind:'plan'})
 const server=useSpendConfirmStore.getInitialState(),saved=server.pending
 server.pending=useSpendConfirmStore.getState().pending
 try {
  const html=renderToStaticMarkup(<MantineProvider env="test"><SpendConfirmDialog /></MantineProvider>)
  const notice=i18n.t('generationCommon.spend.agentNoticePlan')
  // 对话框的名字来自标题元素（Mantine 的 aria-labelledby 指向 h2）：副标在里面必须 aria-hidden，名字才只剩标题。
  const heading=/<h2[\s\S]*?<\/h2>/.exec(html)?.[0]??''
  expect(heading).toContain(title)
  const visible=heading.replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g,'').replace(/<[^>]+>/g,'').trim()
  expect(visible).toBe(title)
  // 副标没丢：正文最前面有一份给读屏的
  expect(html).toMatch(new RegExp(`<span class="[^"]*sr-only[^"]*">${notice}</span>`))
 } finally { server.pending=saved;useSpendConfirmStore.getState().resolvePending(false);await decision }
})
