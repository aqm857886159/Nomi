// 两份策略，两个信任等级，必须同时成立：
//   · 宿主页面：能连模型/远端预览，但**一个 URL 都不许当 frame 加载**；
//   · nomi-local 内容：能跑自己的 inline 脚本/样式做动画，但**一个字节都出不去网**。
// 手艺产物白板那一轮的教训是：不要为了让产物显示而去放宽宿主那份（那等于让不受信内容
// 继承宿主的出网权）。产物走 srcdoc 继承上下文、自带 meta 策略，宿主这份因此一格都不用动。
import { describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import {
  LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY,
  installContentSecurityPolicy,
  isLocalArtifactUrl,
} from './contentSecurityPolicy'

type Captured = { headers: Record<string, string[]> }

/** 跑一次 onHeadersReceived，拿到某个 URL 实际会收到的响应头。 */
function headersFor(url: string, options?: Partial<Parameters<typeof installContentSecurityPolicy>[1]>): Captured {
  let handler: ((details: { url: string; responseHeaders?: Record<string, string[]> }, callback: (result: { responseHeaders: Record<string, string[]> }) => void) => void) | null = null
  const session = {
    webRequest: {
      onHeadersReceived: (fn: typeof handler) => {
        handler = fn
      },
    },
  } as unknown as Session
  installContentSecurityPolicy(session, {
    isDev: false,
    lowMemoryMode: false,
    skipCrossOriginIsolation: false,
    skipCrossOriginIsolationForWindowsFrameless: false,
    disableCrossOriginIsolation: false,
    ...options,
  })
  expect(handler, 'installContentSecurityPolicy 必须注册 onHeadersReceived').toBeTruthy()
  const callback = vi.fn()
  handler!({ url, responseHeaders: { 'Content-Type': ['text/html'] } }, callback)
  return { headers: callback.mock.calls[0][0].responseHeaders }
}

function policyOf(captured: Captured): string {
  return captured.headers['Content-Security-Policy'][0]
}

describe('宿主页面策略', () => {
  // 显示产物**不是**放开 frame-src 的理由：产物走 srcdoc，frame-src 管不到它
  //（真机阳性对照跑过：这条改成放行 nomi-local，产物走查的结果一模一样）。
  // 所以这一格保持关死——远端/本地文件/data 页面永远不能被嵌进画布。
  it('一个 URL 都不放行成 frame', () => {
    const policy = policyOf(headersFor('file:///app/dist/index.html'))
    const frameSrc = policy.split('; ').find((directive) => directive.startsWith('frame-src'))
    expect(frameSrc).toBe("frame-src 'none'")
  })

  // 2026-09-25：隔离模式是 credentialless。require-corp 要求每个跨源子资源自带 CORP，提示词库的第三方示例视频 /
  // 封面在 Mac 版全被拦；credentialless 让 no-cors 媒体不带 cookie 加载、不要求对方带 CORP，隔离与
  // SharedArrayBuffer 照样在（真机探针矩阵见 electron/shared/crossOriginIsolation.ts）。防有人把模式改回去。
  it('宿主页面拿宿主策略与跨源隔离头（credentialless；产物这件事不许顺手削弱宿主）', () => {
    const captured = headersFor('file:///app/dist/index.html')
    expect(policyOf(captured)).toContain("default-src 'self' nomi-local:")
    expect(captured.headers['Cross-Origin-Opener-Policy']).toEqual(['same-origin'])
    expect(captured.headers['Cross-Origin-Embedder-Policy']).toEqual(['credentialless'])
  })
})

describe('nomi-local 产物策略', () => {
  it('nomi-local 响应拿的是产物策略，不是宿主策略', () => {
    const policy = policyOf(headersFor('nomi-local://asset/project-a/assets/imported/2026-09-07/card.html'))
    expect(policy).toBe(LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY)
  })

  it('产物不许出网：默认全禁，connect / 外部脚本 / 外部样式 / 表单外发全断', () => {
    const policy = LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("form-action 'none'")
    expect(policy).toContain("base-uri 'none'")
    expect(policy).toContain("frame-src 'none'")
    // 一条 https: / http: 白名单都不许有——有就是能出站。
    expect(policy).not.toMatch(/https?:/)
  })

  it('产物还是能动：inline 脚本与样式放行（动画/交互靠它），但没有任何外部源', () => {
    const directives = Object.fromEntries(
      LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY.split('; ').map((entry) => {
        const [name, ...rest] = entry.split(' ')
        return [name, rest.join(' ')]
      }),
    )
    expect(directives['script-src']).toBe("'unsafe-inline'")
    expect(directives['style-src']).toBe("'unsafe-inline'")
    // eval 不给：手写动画用不着，留着就是白送一条执行面。
    expect(LOCAL_ARTIFACT_CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval')
    // 图片/媒体只认自包含的 data:/blob:，产物翻不到项目里别的资产。
    expect(directives['img-src']).toBe('data: blob:')
    expect(directives['media-src']).toBe('data: blob:')
  })

  it('跨源隔离被关掉时（低内存等）不发隔离头', () => {
    const captured = headersFor('file:///app/dist/index.html', { lowMemoryMode: true })
    expect(captured.headers['Cross-Origin-Embedder-Policy']).toBeUndefined()
    expect(captured.headers['Cross-Origin-Opener-Policy']).toBeUndefined()
  })

  it('协议判定只认 nomi-local:，不被同名前缀或大小写绕过', () => {
    expect(isLocalArtifactUrl('nomi-local://asset/p/a.html')).toBe(true)
    expect(isLocalArtifactUrl('NOMI-LOCAL://asset/p/a.html')).toBe(true)
    expect(isLocalArtifactUrl('https://evil.example/nomi-local://a.html')).toBe(false)
    expect(isLocalArtifactUrl('file:///app/dist/index.html')).toBe(false)
  })
})
