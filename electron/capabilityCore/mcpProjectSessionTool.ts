/** Generic project-session MCP surface. It is deliberately outside generation rollout policy. */
export const MCP_PROJECT_SESSION_TOOL = Object.freeze({
  name: 'nomi_session_open',
  title: '打开当前项目的安全会话，拿一个短期项目句柄。',
  description: '打开当前项目的安全会话；只返回一个可短期使用、绑定当前连接的项目句柄。',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      projectSelectionHandle: Object.freeze({ type: 'string' }),
      bootstrap: Object.freeze({
        type: 'object',
        properties: Object.freeze({
          mode: Object.freeze({ type: 'string', enum: Object.freeze(['current_project']) }),
        }),
        additionalProperties: false,
      }),
    }),
    additionalProperties: false,
  }),
  method: 'nomi_session_open',
  build: (args: Record<string, unknown>) => ({
    ...(typeof args.projectSelectionHandle === 'string'
      ? { projectSelectionHandle: args.projectSelectionHandle }
      : {}),
    ...(args.bootstrap !== undefined ? { bootstrap: args.bootstrap } : {}),
  }),
})
