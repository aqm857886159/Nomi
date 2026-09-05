import { describe, expect, it } from 'vitest'

import { MCP_TOOL_RESOLVER, assertMcpToolTitles } from './mcpToolCatalog'

const SEMANTIC_TOOLS = [
  'nomi_canvas_maintenance', 'nomi_document_read', 'nomi_document_edit',
  'nomi_timeline_read', 'nomi_timeline_edit', 'nomi_export_job', 'nomi_media_query',
  'nomi_layout_read', 'nomi_layout_write',
] as const

describe('MCP semantic tool titles', () => {
  it('provides a human title in both supported locales for every semantic tool', () => {
    for (const name of SEMANTIC_TOOLS) {
      const tool = MCP_TOOL_RESOLVER.resolve(name)
      expect(tool?.title, `${name} has a zh-CN title`).toBeTruthy()
      const localized = (tool as { titleByLocale?: { 'zh-CN': string; en: string } } | undefined)?.titleByLocale
      expect(localized?.['zh-CN'], `${name} has a localized zh-CN title`).toBeTruthy()
      expect(localized?.en, `${name} has a localized en title`).toBeTruthy()
      expect(localized?.en).not.toBe(localized?.['zh-CN'])
    }
  })

  it('fails the directory invariant if a title is removed', () => {
    const missingTitle = MCP_TOOL_RESOLVER.list().map((tool) => tool.name === 'nomi_media_query' ? { ...tool, title: '' } : tool)
    expect(() => assertMcpToolTitles(missingTitle)).toThrow('nomi_media_query')
  })
})
