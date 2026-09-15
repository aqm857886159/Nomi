import { describe, expect, it } from 'vitest'
import { checkImportAsset, contentTypeForExtension } from './importAssetGuard'

// MCP 清单 M2 的守门人测试。这是「让远端 agent 读本机文件」的口子——判据错一条就是任意文件读取，
// 故逐条钉死。deny 优先于白名单（改名成 .png 的私钥也进不来），且 deny 对**软链解析后**的真实路径再查。

const base = { rawPath: '/Users/me/Desktop/ref.png', realPath: '/Users/me/Desktop/ref.png', sizeBytes: 1024, isFile: true }

describe('checkImportAsset · 放行', () => {
  it('普通目录的 png → 放行，回真实路径与扩展名', () => {
    const v = checkImportAsset(base)
    expect(v.ok).toBe(true)
    if (v.ok) { expect(v.realPath).toBe('/Users/me/Desktop/ref.png'); expect(v.extension).toBe('.png') }
  })
  it('视频素材（mp4/mov）也放行', () => {
    expect(checkImportAsset({ ...base, rawPath: '/Users/me/a.mp4', realPath: '/Users/me/a.mp4' }).ok).toBe(true)
    expect(checkImportAsset({ ...base, rawPath: '/Users/me/a.MOV', realPath: '/Users/me/a.MOV' }).ok).toBe(true)
  })
  it('目录名含 ssh 但不是 .ssh 段 → 不误伤（段匹配非子串）', () => {
    expect(checkImportAsset({ ...base, rawPath: '/Users/me/sshots/a.png', realPath: '/Users/me/sshots/a.png' }).ok).toBe(true)
  })
})

describe('checkImportAsset · 拒绝（每条都是一个真实攻击/误用面）', () => {
  const reason = (input: Parameters<typeof checkImportAsset>[0]) => {
    const v = checkImportAsset(input)
    expect(v.ok).toBe(false)
    return v.ok ? '' : v.reason
  }

  it('相对路径 → 拒（依赖 cwd，结果不可预期）', () => {
    expect(reason({ ...base, rawPath: 'ref.png' })).toContain('绝对路径')
  })
  it('空路径 → 拒', () => {
    expect(reason({ ...base, rawPath: '   ' })).toContain('路径')
  })
  it('文件不存在（realPath=null）→ 拒，人话提示', () => {
    expect(reason({ ...base, realPath: null })).toContain('找不到')
  })
  it('~/.ssh 下的文件 → 拒（凭据目录）', () => {
    expect(reason({ ...base, rawPath: '/Users/me/.ssh/id_rsa.png', realPath: '/Users/me/.ssh/id_rsa.png' })).toContain('不允许')
  })
  it('~/.nomi 下的文件 → 拒（capability-core 的 RPC token 在里面，绝不能被当素材读走）', () => {
    expect(reason({ ...base, rawPath: '/Users/me/.nomi/capability-core/token', realPath: '/Users/me/.nomi/capability-core/token' })).toContain('不允许')
  })
  it('/etc 下的文件 → 拒（系统目录前缀）', () => {
    expect(reason({ ...base, rawPath: '/etc/passwd.png', realPath: '/etc/passwd.png' })).toContain('不允许')
  })
  it('★软链逃逸：看起来是桌面的 png，realpath 指向 ~/.ssh → 拒（deny 查解析后的真实路径）', () => {
    expect(reason({ ...base, rawPath: '/Users/me/Desktop/innocent.png', realPath: '/Users/me/.ssh/id_rsa' })).toContain('不允许')
  })
  it('非媒体扩展名（.pdf/.ts/无扩展）→ 拒', () => {
    expect(reason({ ...base, rawPath: '/Users/me/a.pdf', realPath: '/Users/me/a.pdf' })).toContain('只支持')
    expect(reason({ ...base, rawPath: '/Users/me/a.ts', realPath: '/Users/me/a.ts' })).toContain('只支持')
    expect(reason({ ...base, rawPath: '/Users/me/noext', realPath: '/Users/me/noext' })).toContain('只支持')
  })
  // 2026-09-14：白名单从素材库面的 kinds 派生，Agent 能导入的和用户能导入的不再是两套。
  it('用户能导入的媒体，Agent 也能导入（音频 / mkv / avif 此前被这份窄清单拒掉）', () => {
    for (const file of ['a.mp3', 'a.wav', 'a.m4a', 'a.mkv', 'a.avif', 'a.avi', 'a.glb']) {
      expect(checkImportAsset({ ...base, rawPath: `/Users/me/${file}`, realPath: `/Users/me/${file}` }).ok).toBe(true)
    }
  })
  it('目录/非常规文件 → 拒', () => {
    expect(reason({ ...base, isFile: false })).toContain('普通文件')
  })
  it('空文件 / 读不到大小 → 拒', () => {
    expect(reason({ ...base, sizeBytes: 0 })).toContain('空')
    expect(reason({ ...base, sizeBytes: null })).toContain('空')
  })
  // 「多大算大」不在这一层：2026-09-15 把体积判据收回唯一的准入闸（admitMediaImport，
  // 按磁盘余量 + 每面硬顶）。这条钉住本层**不再**自己拿一个上限拦人——
  // 一个大得离谱的文件在这里必须放行，由准入闸带着数字拒它。
  it('体积不再由本层判：再大也放行，交给准入闸', () => {
    expect(checkImportAsset({ ...base, sizeBytes: 8 * 1024 * 1024 * 1024 }).ok).toBe(true)
  })
})

describe('contentTypeForExtension', () => {
  it('常见图/视频扩展名映射正确，未知回落通用二进制', () => {
    expect(contentTypeForExtension('.png')).toBe('image/png')
    expect(contentTypeForExtension('.JPG')).toBe('image/jpeg')
    expect(contentTypeForExtension('.mp4')).toBe('video/mp4')
    expect(contentTypeForExtension('.xyz')).toBe('application/octet-stream')
  })
})
