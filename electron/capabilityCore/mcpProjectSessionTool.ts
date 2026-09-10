/** Generic project-session MCP surface. It is deliberately outside generation rollout policy. */
export const MCP_PROJECT_SESSION_TOOL = Object.freeze({
  name: 'nomi_session_open',
  title: '打开项目安全会话',
  description: '打开当前项目安全会话，返回绑定当前连接的短期项目句柄。',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      projectSelectionHandle: Object.freeze({ type: 'string', maxLength: 200, description: 'nomi_read target=projects 每行给的短 id，原样传回；不要自己拼。' }),
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
