// 边界测试：Codex 的两个方向必须保持分开。
//
// Codex 在 Nomi 里是两件方向相反的事：
//   ① Codex **→** Nomi：Codex 当司机，经 MCP 驱动 Nomi（ConnectAssistantCard）。
//   ② Nomi **→** Codex：Nomi spawn `codex exec` 出图，烧用户自己的额度（CodexLocalImageCard）。
// 旧实现把 ② 做成 ① 的副作用：接入 MCP 顺带开生图、撤销顺带关，而且 OnboardingDrawer 每次刷新还会
// 把 codex-local 的 enabled 强制掰回 MCP 接入状态 —— 用户自己在卡里关掉，下次打开面板又被打开
// （冲用户数据，违反「更新绝不冲用户数据」）。
//
// 这两条断言用源码扫描而非组件测试：本仓无 @testing-library/react，且要防的正是「有人顺手把联动写回去」
// 这种结构性回退，扫源码比渲染断言更直接、更难绕过。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// fileURLToPath 而非 new URL().pathname：后者在 Windows 上会带盘符前的斜杠、路径拼不对。
const dir = path.dirname(fileURLToPath(import.meta.url))
const read = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8')

describe('Codex 两个方向必须分开', () => {
  it('接入 AI 编程助手卡不许碰模型目录（接入 MCP ≠ 开生图模型）', () => {
    const src = read('ConnectAssistantCard.tsx')
    // 这张卡只写各客户端的 MCP 配置；一旦出现 vendor 写入就是又把两个方向绑回去了。
    expect(src).not.toContain('upsertVendor')
    expect(src).not.toContain('CODEX_LOCAL_VENDOR_KEY')
    expect(src).not.toContain('modelCatalog')
  })

  it('抽屉不许再按 MCP 接入状态强制回写 codex-local 的开关（那会冲掉用户自己的选择）', () => {
    const src = read('OnboardingDrawer.tsx')
    // 允许读 CODEX_LOCAL_VENDOR_KEY（分桶/过滤要用），但不许把它和 MCP 接入状态绑在一起回写。
    const forcedWriteBack = /upsertVendor\(\s*\{\s*key:\s*CODEX_LOCAL_VENDOR_KEY[^}]*enabled:\s*codex/i
    expect(forcedWriteBack.test(src)).toBe(false)
    // 更宽的兜底：抽屉里不该出现「codex 已接入」这种由 MCP 派生的开关变量。
    expect(src).not.toContain('codexInstalled')
  })

  it('生图卡自己管开关，且不掺和 MCP 接入状态', () => {
    const src = read('CodexLocalImageCard.tsx')
    expect(src).toContain('upsertVendor')
    expect(src).toContain('CODEX_LOCAL_VENDOR_KEY')
    // 这张卡不该读 MCP 接入状态——它开不开与助手接没接入无关。
    expect(src).not.toContain('mcpInfo')
    expect(src).not.toContain('installMcp')
  })

  it('生图开关写盘失败时必须给出错误反馈，不能表现成死按钮', () => {
    const src = read('CodexLocalImageCard.tsx')
    expect(src).toContain('} catch (error)')
    expect(src).toContain("toast(error instanceof Error ? error.message")
    expect(src).toContain("'error'")
  })
})
