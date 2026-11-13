// 可找回面板要把最后一次取回失败的原话给出来（#1213）：以前只有固定文案，用户截图里没有任何证据，
// 也不知道「重新拉取」为什么一直撞墙。三件套（服务商原话 / 复制详情 / 技术详情）与失败卡同一份实现。
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n from '../../../i18n'
import { NodeRecoverableReport } from './NodeRecoverableReport'

// 与真实路径同形：主进程的 VendorRequestError 经 taskIpcGuard 编成带结构化标记的消息穿过 IPC，
// 轮询循环把它原样交给 RecoverableTimeoutError，再落到节点上。
const UPSTREAM = '当前分组 default 下对于模型  无可用渠道'
const RETRIEVAL_FAILURE =
  'NOMI_VENDOR_ERR_B64::' +
  Buffer.from(JSON.stringify({ vendorKey: 'relay', method: 'GET', httpStatus: 503, upstreamMsg: UPSTREAM, category: 'server', retryable: true }), 'utf8').toString('base64') +
  `:: Provider request failed (HTTP 503) at relay GET https://relay.example/api/v3/contents/generations/tasks/cgt-1: ${UPSTREAM}`

describe('NodeRecoverableReport', () => {
  it('shows the last retrieval failure as the provider message, with copy + technical details', () => {
    const markup = renderToStaticMarkup(<NodeRecoverableReport node={{ runs: [], error: RETRIEVAL_FAILURE }} onRecover={() => {}} onDismiss={() => {}} />)
    expect(markup).toContain(i18n.t('generationCommon.error.providerMessage'))
    expect(markup).toContain('无可用渠道')
    expect(markup).toContain(i18n.t('generationCommon.error.copyDetails'))
    expect(markup).toContain(i18n.t('generationCommon.error.technicalDetails'))
  })

  it('a reasonless wait-timeout keeps the plain panel (nothing invented)', () => {
    const markup = renderToStaticMarkup(<NodeRecoverableReport node={{ runs: [] }} onRecover={() => {}} onDismiss={() => {}} />)
    expect(markup).not.toContain(i18n.t('generationCommon.error.providerMessage'))
    expect(markup).not.toContain(i18n.t('generationCommon.error.copyDetails'))
    expect(markup).toContain(i18n.t('generationCommon.recoverable.title'))
  })

  // C5（⑬）：查询时被 Nomi 自己的出站守卫（凭据绑定）拦下。守卫按「提交」挂码，拒绝的话同时进了 structured.upstreamMsg——
  // 可找回面板绝不能把「这次生成没有发出去……重新生成」当成服务商原话印出来（任务已经提交、钱已经花了）。
  it('a query refused by Nomi itself never shows the pre-submit "was never sent / generate again" claim', () => {
    const refusal = 'NOMI_ERR::outbound-blocked-credential-origin:: 这次生成**没有发出去**：密钥要去的地址不是保存时确认的那个，请重新保存密钥后重新生成。'
    const passedThrough =
      'NOMI_VENDOR_ERR_B64::' +
      Buffer.from(JSON.stringify({ vendorKey: 'relay', method: 'GET', upstreamMsg: refusal, category: 'network', retryable: false }), 'utf8').toString('base64') +
      `:: Provider request refused by outbound policy at relay GET https://relay.example/v1/tasks/t-1: ${refusal}`
    const retagged = 'NOMI_ERR::retrieval-query:: 取回卡在「查询任务」这一步：Nomi 在本机拦下了这次请求（原始码 outbound-blocked-credential-origin）'
    for (const error of [passedThrough, retagged]) {
      const markup = renderToStaticMarkup(<NodeRecoverableReport node={{ runs: [], error }} onRecover={() => {}} onDismiss={() => {}} />)
      expect(markup).not.toMatch(/生成\**没有发出去|was never sent/)
      expect(markup).toContain(i18n.t('generationCommon.production.runAction.retry-retrieval'))
    }
  })
})
