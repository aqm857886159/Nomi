import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { SkillListItemDto } from '../api/skillApi'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars?.version) return `${key}:${vars.version}`
      if (vars?.hash) return `${key}:${vars.hash}`
      if (vars?.name) return `${key}:${vars.name}`
      if (vars?.count !== undefined) return `${key}:${vars.count}`
      return key
    },
  }),
}))

import { SkillCard } from './SkillCard'

function makeSkill(overrides: Partial<SkillListItemDto> = {}): SkillListItemDto {
  return {
    directoryName: 'brand-promo',
    name: 'brand.promo',
    label: 'Brand promo',
    description: 'Make a launch film',
    author: 'Nomi',
    provenance: { source: 'builtin', version: '1.2.3', contentHash: '0123456789abcdef' },
    stageLabels: ['storyboard'],
    isPlaybook: true,
    neededProviders: [],
    manifestError: null,
    origin: 'builtin',
    ...overrides,
  }
}

describe('SkillCard', () => {
  it('shows source, version and hash in the card body', () => {
    const html = renderToStaticMarkup(
      <SkillCard
        skill={makeSkill()}
        available={new Set()}
        onUse={() => undefined}
        onExport={() => undefined}
        onDelete={() => undefined}
      />,
    )

    expect(html).toContain('libraries.skill.source.builtin')
    expect(html).toContain('libraries.skill.version:1.2.3')
    expect(html).toContain('libraries.skill.hash:01234567')
    expect(html).toContain('0123456789abcdef')
  })
})
