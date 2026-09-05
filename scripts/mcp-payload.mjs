// Shared MCP tools/list payload projection and locale-independent ratchet metric.
// Keep the supported locale set explicit: the baseline must cover every payload
// shape a supported host can receive, regardless of the runner's machine locale.
export const MCP_SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en'])

export function serializeMcpToolsListPayload(tools, locale) {
  return {
    tools: tools.map((tool) => {
      const localizedTitles = tool.titleByLocale
      const selectedTitle = localizedTitles?.[locale] ?? tool.title
      const title = typeof selectedTitle === 'string' && selectedTitle.length > 0 ? { title: selectedTitle } : {}
      return {
        name: tool.name,
        ...title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }
    }),
  }
}

export function measureMcpToolsListPayloadByLocale(tools) {
  return Object.fromEntries(MCP_SUPPORTED_LOCALES.map((locale) => [
    locale,
    Buffer.byteLength(JSON.stringify(serializeMcpToolsListPayload(tools, locale))),
  ]))
}

export function measureMcpToolsListPayload(tools) {
  return Math.max(...Object.values(measureMcpToolsListPayloadByLocale(tools)))
}
