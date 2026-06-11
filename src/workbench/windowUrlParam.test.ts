import { describe, expect, it } from 'vitest'
import { urlParamFromHref } from './windowUrlParam'

// 回归锁:打包版(file:// + hash 路由)的 projectId 曾被 search-only 解析丢掉,
// 导致 agent 会话桶全落 `local`(跨项目串台)且事件轨迹静默不落盘。
describe('urlParamFromHref', () => {
  it('dev 形态:search 段直读', () => {
    expect(urlParamFromHref('http://127.0.0.1:5173/?projectId=p-1', 'projectId')).toBe('p-1')
  })

  it('prod 形态:hash 路由里的参数必须读得到(打包版回归锁)', () => {
    expect(
      urlParamFromHref('file:///Applications/Nomi.app/dist/index.html?step=generate#/studio?projectId=p-42', 'projectId'),
    ).toBe('p-42')
  })

  it('search 段优先于 hash 段', () => {
    expect(urlParamFromHref('http://x/?projectId=a#/studio?projectId=b', 'projectId')).toBe('a')
  })

  it('两段都没有 → 空串;非法 URL → 空串', () => {
    expect(urlParamFromHref('file:///x/index.html#/studio', 'projectId')).toBe('')
    expect(urlParamFromHref('not a url', 'projectId')).toBe('')
  })
})
