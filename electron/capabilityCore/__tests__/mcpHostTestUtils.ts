import type { McpHost } from '../mcpProtocol'

/**
 * 单测专用的 McpHost 完整桩：createNomiMcpServer 生产工厂入参已收紧为 Required<McpHost>
 * （由 TypeScript 编译器替代已退役的 check:transport-assembly 门岗），测试只需覆盖关心的回调，
 * 其余成员显式填默认桩以满足编译期必填约束。
 */
export function createTestMcpHost(
  overrides: Partial<Required<McpHost>> & Pick<McpHost, 'invoke' | 'isAppOpen'>,
): Required<McpHost> {
  return {
    invokeIfOpen: async () => undefined,
    getAuthenticatedClient: () => 'codex',
    verifyClientGenerationConfirmation: async () => ({ confirmed: false }),
    confirmGenerationInNomi: async () => ({ confirmed: false }),
    getLocale: () => 'zh-CN',
    onClientDetected: () => {},
    ...overrides,
  }
}
