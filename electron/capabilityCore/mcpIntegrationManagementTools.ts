const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 管理已接入连接的后端动词；UI 仍需另出样张，本班不改 UI。 */
export const MCP_INTEGRATION_MANAGEMENT_TOOL = {
  name: 'nomi_integration_manage',
  title: '管理已接入连接：改配置、删除、切换单连接代理。',
  description: '只接收公开配置；key 只进 Nomi 安全页。',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['update_vendor', 'delete_vendor', 'delete_model', 'set_proxy'] },
      vendorKey: { type: 'string', minLength: 1, maxLength: 160 },
      modelKey: { type: 'string', minLength: 1, maxLength: 160 },
      name: { type: 'string', minLength: 1, maxLength: 240 },
      baseUrl: { type: 'string', maxLength: 2000 },
      authType: { type: 'string', enum: ['none', 'bearer', 'x-api-key', 'query'] },
      authHeader: { type: 'string', maxLength: 200 },
      authQueryParam: { type: 'string', maxLength: 200 },
      providerKind: { type: 'string', maxLength: 80 },
      enabled: { type: 'boolean' },
    },
    required: ['action', 'vendorKey'],
    additionalProperties: false,
  },
  method: 'integration.manage.update_vendor',
  resolveMethod: (a: Record<string, unknown>): string => `integration.manage.${str(a.action) || 'update_vendor'}`,
  build: (a: Record<string, unknown>): Record<string, unknown> => ({
    action: a.action,
    vendorKey: a.vendorKey,
    ...(typeof a.modelKey === 'string' ? { modelKey: a.modelKey } : {}),
    ...(typeof a.name === 'string' ? { name: a.name } : {}),
    ...(typeof a.baseUrl === 'string' ? { baseUrl: a.baseUrl } : {}),
    ...(typeof a.authType === 'string' ? { authType: a.authType } : {}),
    ...(typeof a.authHeader === 'string' ? { authHeader: a.authHeader } : {}),
    ...(typeof a.authQueryParam === 'string' ? { authQueryParam: a.authQueryParam } : {}),
    ...(typeof a.providerKind === 'string' ? { providerKind: a.providerKind } : {}),
    ...(typeof a.enabled === 'boolean' ? { enabled: a.enabled } : {}),
  }),
} as const
