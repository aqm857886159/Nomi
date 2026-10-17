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
})
