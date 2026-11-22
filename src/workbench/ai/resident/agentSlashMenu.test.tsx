import React, { type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../v4/testReactRenderer'
import i18n from '../../../i18n'
import type { SkillListItemDto } from '../../api/skillApi'
import type { LibraryPrompt } from '../../api/promptLibraryApi'
import type { ComposerPopover, V4ComposerReference } from '../v4/agentPanelV4Types'

vi.mock('../../assets/PromptEditor', () => ({
  default: () => null,
}))

vi.mock('../../../design', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../design')>()
  const pass = ({ children }: { children?: React.ReactNode }) => children ?? null
  return {
    ...actual,
    Tooltip: pass,
    TooltipTrigger: pass,
    TooltipContent: () => null,
    TooltipProvider: pass,
    HoverCard: pass,
    HoverCardTrigger: pass,
    HoverCardContent: () => null,
  }
})

import { AgentPanelV4Composer, V4SkillPopover } from '../v4/AgentPanelV4Composer'
import { buildAgentSlashRows, parseAgentSlashQuery, useAgentSlashMenu } from './agentSlashMenu'

const SAMPLE_SKILLS: readonly SkillListItemDto[] = [
  {
    name: 'brand-film-director',
    origin: 'builtin',
    description: '做产品/品牌宣传片',
    cover: 'nomi-local://skill/brand.png',
    stageLabels: ['创作'],
    curation: {
      kind: 'skill',
      title: { 'zh-CN': '产品宣传短片', en: 'Brand Film' },
      summary: { 'zh-CN': '把产品卖点做成短宣传视频。', en: 'Turn product highlights into a short promo film.' },
      group: { 'zh-CN': '创作流程', en: 'Workflow' },
      preview: { provenance: 'illustration' },
    },
  } as unknown as SkillListItemDto,
  {
    name: 'storyboard-planner',
    origin: 'builtin',
    description: '拆成分镜',
    cover: 'nomi-local://skill/storyboard.png',
    stageLabels: ['分镜'],
    curation: {
      kind: 'skill',
      title: { 'zh-CN': '分镜规划', en: 'Storyboard Planner' },
      summary: { 'zh-CN': '把短故事拆成有序镜头。', en: 'Break a short story into ordered shots.' },
      group: { 'zh-CN': '创作流程', en: 'Workflow' },
      preview: { provenance: 'illustration' },
    },
  } as unknown as SkillListItemDto,
  {
    name: 'my-custom-writer',
    origin: 'user',
    description: '我的自定义写作技能',
    stageLabels: [],
  } as unknown as SkillListItemDto,
  {
    name: 'effect-should-not-be-in-skills',
    origin: 'builtin',
    description: '效果不应出现在技能段',
    stageLabels: [],
    curation: {
      kind: 'effect',
      title: { 'zh-CN': '不应出现的效果', en: 'Hidden Effect' },
      summary: { 'zh-CN': '不应出现', en: 'Hidden' },
      group: { 'zh-CN': '构图', en: 'Composition' },
    },
  } as unknown as SkillListItemDto,
]

const SAMPLE_PROMPTS: readonly LibraryPrompt[] = [
  {
    id: 'effect-dolly-track',
    title: '推轨跟拍',
    prompt: 'Smooth dolly tracking behind the walking subject',
    mediaUrl: 'nomi-local://prompt/dolly.jpg',
    mediaType: 'image',
    promptType: 'video',
    origin: 'curated',
    source: 'Nomi',
    sourceId: 'builtin-effects',
    sourceUrl: '',
    tags: [],
    curation: {
      kind: 'effect',
      title: { 'zh-CN': '推轨跟拍', en: 'Dolly Tracking' },
      summary: { 'zh-CN': '平稳推轨跟拍主体。', en: 'Smooth dolly tracking shot.' },
      group: { 'zh-CN': '运镜', en: 'Camera Move' },
      preview: { provenance: 'illustration' },
    },
  } as unknown as LibraryPrompt,
  {
    id: 'public-over-shoulder',
    title: '过肩对话',
    prompt: 'Long-lens over-the-shoulder shot',
    mediaUrl: 'nomi-local://prompt/ots.jpg',
    mediaType: 'image',
    promptType: 'image',
    origin: 'public',
    source: 'Public',
    sourceId: 'pub-1',
    sourceUrl: '',
    tags: [],
  } as unknown as LibraryPrompt,
]

const SAMPLE_USER_PROMPTS: readonly LibraryPrompt[] = [
  {
    id: 'user-prompt-1',
    title: '黄昏剪影',
    prompt: 'Warm dusk silhouette against amber sky',
    mediaUrl: '',
    mediaType: 'image',
    promptType: 'image',
    origin: 'user',
    source: '',
    sourceId: 'user',
    sourceUrl: '',
    tags: [],
  } as unknown as LibraryPrompt,
]

function makeKeyEvent(key: string) {
  let prevented = false
  let stopped = false
  return {
    key,
    shiftKey: false,
    nativeEvent: { isComposing: false },
    preventDefault: () => { prevented = true },
    stopPropagation: () => { stopped = true },
    get prevented() { return prevented },
    get stopped() { return stopped },
  }
}

describe('parseAgentSlashQuery', () => {
  it('opens on leading slash and extracts filter query', () => {
    expect(parseAgentSlashQuery('/')).toBe('')
    expect(parseAgentSlashQuery('/分镜')).toBe('分镜')
    expect(parseAgentSlashQuery('/dolly track')).toBe('dolly track')
  })

  it('never conflicts with @ mentions, mid-text slashes, URLs, or multiline drafts', () => {
    expect(parseAgentSlashQuery('')).toBeNull()
    expect(parseAgentSlashQuery('@image1')).toBeNull()
    expect(parseAgentSlashQuery('/@image1')).toBeNull()
    expect(parseAgentSlashQuery('帮我用 @图1 改图')).toBeNull()
    expect(parseAgentSlashQuery('https://example.com/a')).toBeNull()
    expect(parseAgentSlashQuery('hello /world')).toBeNull()
    expect(parseAgentSlashQuery('/分镜\n第二行')).toBeNull()
  })
})

describe('buildAgentSlashRows (LibraryPointers contract)', () => {
  it('merges effects into Prompts, groups with section prefix, omits internal ids, and propagates illustration flag', () => {
    const rows = buildAgentSlashRows({
      skills: SAMPLE_SKILLS,
      promptItems: SAMPLE_PROMPTS,
      userPromptItems: SAMPLE_USER_PROMPTS,
      query: '',
      language: 'zh-CN',
      sectionSkills: '技能',
      sectionPrompts: '提示词',
      mineLabel: '我的',
      activeSkillKey: 'storyboard-planner',
      selectedPromptId: null,
    })

    // effect-should-not-be-in-skills is excluded from skills; user skill sorted first
    const skillRows = rows.filter((r) => r.id.startsWith('skill:'))
    expect(skillRows.map((r) => r.id)).toEqual([
      'skill:my-custom-writer',
      'skill:brand-film-director',
      'skill:storyboard-planner',
    ])
    expect(skillRows[0].group).toEqual({ id: 'mine', label: '技能 · 我的' })
    expect(skillRows[1].group).toEqual({ id: 'category:Workflow', label: '技能 · 创作流程' })
    expect(skillRows[1].illustration).toBe(true)
    expect(skillRows[1].command).toBeUndefined()
    expect(skillRows[2].selected).toBe(true)

    // Effects belong under Prompts (Q1), not a separate Effects category
    const promptRows = rows.filter((r) => r.id.startsWith('prompt:'))
    expect(promptRows.every((r) => r.section === '提示词')).toBe(true)
    expect(promptRows[0].group).toEqual({ id: 'category:Camera Move', label: '提示词 · 运镜' })
    expect(promptRows[0].illustration).toBe(true)
    expect(promptRows[0].command).toBeUndefined()
    expect(promptRows[2].group).toEqual({ id: 'mine', label: '提示词 · 我的' })
  })

  it('uses localized English titles and group labels when language is en', async () => {
    await i18n.changeLanguage('en')
    const rows = buildAgentSlashRows({
      skills: SAMPLE_SKILLS,
      promptItems: SAMPLE_PROMPTS,
      userPromptItems: [],
      query: '',
      language: 'en',
      sectionSkills: 'Skills',
      sectionPrompts: 'Prompts',
      mineLabel: 'Mine',
      activeSkillKey: null,
      selectedPromptId: 'effect-dolly-track',
    })
    const brand = rows.find((r) => r.id === 'skill:brand-film-director')
    const dolly = rows.find((r) => r.id === 'prompt:effect-dolly-track')
    expect(brand?.name).toBe('Brand Film')
    expect(brand?.group?.label).toBe('Skills · Workflow')
    expect(dolly?.name).toBe('Dolly Tracking')
    expect(dolly?.group?.label).toBe('Prompts · Camera Move')
    expect(dolly?.selected).toBe(true)
    await i18n.changeLanguage('zh-CN')
  })
})

describe('useAgentSlashMenu + V4SkillPopover + ComposerChip interactive flows', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('supports / trigger, live query filtering, empty state, ArrowUp/ArrowDown/Enter selection, and Escape dismissal', () => {
    let latestApi: ReturnType<typeof useAgentSlashMenu> | null = null
    let latestPopover: ComposerPopover | null = null
    let draft = ''
    let selectedSkill: string | null = null
    let selectedPrompt: LibraryPrompt | null = null
    let focusedCount = 0

    function Harness(): JSX.Element {
      const [popover, setPopover] = React.useState<ComposerPopover | null>(null)
      latestPopover = popover
      const menu = useAgentSlashMenu({
        popover,
        setPopover,
        skills: SAMPLE_SKILLS,
        promptItems: SAMPLE_PROMPTS,
        userPromptItems: SAMPLE_USER_PROMPTS,
        activeSkillKey: selectedSkill,
        selectedPromptId: selectedPrompt?.id ?? null,
        getDraft: () => draft,
        clearSlashDraft: () => { draft = '' },
        focusComposer: () => { focusedCount += 1 },
        onSelectSkill: (key) => { selectedSkill = key; selectedPrompt = null },
        onSelectPrompt: (prompt) => { selectedPrompt = prompt; selectedSkill = null },
      })
      latestApi = menu
      return (
        <div>
          {popover === 'skill' ? (
            <V4SkillPopover
              rows={menu.commandRows}
              categories={menu.categories}
              query={menu.commandQuery}
              pickerRef={menu.pickerRef}
              onQueryChange={menu.setCommandQuery}
              onSelect={menu.selectRow}
              onClose={menu.dismissPopover}
            />
          ) : null}
        </div>
      )
    }

    const instances = new Set<{ type: string; props: Record<string, unknown> }>()
    const renderer = createReactTestRenderer({
      createInstance: (type, props) => {
        const node = { type, props }
        instances.add(node)
        return node
      },
      commitUpdate: (instance, props) => {
        instance.props = props
      },
    })
    const findProp = (key: string, value: unknown) => [...instances].find((node) => node.props[key] === value)
    try {
      renderer.render(<Harness />)
      expect(latestPopover).toBeNull()

      // 1. Typing `/` opens slash popover with 3 categories (全部 / 技能 / 提示词)
      draft = '/'
      latestApi!.handleDraftWrite(draft)
      renderer.flushPassiveEffects()
      expect(latestPopover).toBe('skill')
      expect(latestApi!.categories).toEqual(['全部', '技能', '提示词'])

      // 2. Typing `/不存在xyz` shows empty state and Enter does not crash or select
      instances.clear()
      draft = '/不存在xyz'
      latestApi!.handleDraftWrite(draft)
      renderer.flushPassiveEffects()
      expect(latestApi!.commandRows).toHaveLength(0)
      expect(findProp('data-v4-skill-empty', 'true')).toBeDefined()
      const enterEmpty = makeKeyEvent('Enter')
      expect(latestApi!.handleComposerKeyDown(enterEmpty)).toBe(true)
      expect(enterEmpty.prevented).toBe(true)
      expect(selectedSkill).toBeNull()

      // 3. Typing `/分镜` filters to 分镜规划; ArrowDown + Enter selects it, clears draft, closes popover, restores focus
      instances.clear()
      draft = '/分镜'
      latestApi!.handleDraftWrite(draft)
      renderer.flushPassiveEffects()
      expect(latestApi!.commandRows.map((r) => r.id)).toEqual(['skill:storyboard-planner'])
      const down = makeKeyEvent('ArrowDown')
      expect(latestApi!.handleComposerKeyDown(down)).toBe(true)
      renderer.flushPassiveEffects()
      const activeButton = findProp('data-library-active', 'true')
      expect(activeButton?.props['data-v4-command']).toBe('skill:storyboard-planner')

      const enter = makeKeyEvent('Enter')
      expect(latestApi!.handleComposerKeyDown(enter)).toBe(true)
      renderer.flushPassiveEffects()
      expect(selectedSkill).toBe('storyboard-planner')
      expect(draft).toBe('')
      expect(latestPopover).toBeNull()
      expect(focusedCount).toBe(1)

      // 4. Typing `/` then pressing Escape closes popover and keeps it dismissed for that draft
      draft = '/'
      latestApi!.handleDraftWrite(draft)
      renderer.flushPassiveEffects()
      expect(latestPopover).toBe('skill')
      const esc = makeKeyEvent('Escape')
      expect(latestApi!.handleComposerKeyDown(esc)).toBe(true)
      renderer.flushPassiveEffects()
      expect(latestPopover).toBeNull()
      latestApi!.handleDraftWrite('/')
      renderer.flushPassiveEffects()
      expect(latestPopover).toBeNull()

      // 5. Typing `@` closes slash menu and never triggers it
      draft = '@image1'
      latestApi!.handleDraftWrite(draft)
      renderer.flushPassiveEffects()
      expect(latestPopover).toBeNull()
    } finally {
      renderer.close()
    }
  })

  it('renders distinct home icons for skill chip (IconBooks) vs prompt chip (IconBulb) and removes on x click', () => {
    let removed: string | null = null
    const chips: readonly V4ComposerReference[] = [
      { id: 'skill:storyboard-planner', kind: 'skill', label: '分镜规划', onRemove: () => { removed = 'skill' } },
      { id: 'prompt:effect-dolly-track', kind: 'prompt', label: '推轨跟拍', onRemove: () => { removed = 'prompt' } },
    ]
    const instances = new Set<{ type: string; props: Record<string, unknown> }>()
    const renderer = createReactTestRenderer({
      createInstance: (type, props) => {
        const node = { type, props }
        instances.add(node)
        return node
      },
      commitUpdate: (instance, props) => {
        instance.props = props
      },
    })
    try {
      renderer.render(<AgentPanelV4Composer chips={chips} />)
      renderer.flushPassiveEffects()
      const all = [...instances]
      expect(all.some((n) => n.props['data-v4-chip'] === 'skill')).toBe(true)
      expect(all.some((n) => n.props['data-v4-chip'] === 'prompt')).toBe(true)
      expect(all.some((n) => n.props['data-v4-chip-icon'] === 'skill')).toBe(true)
      expect(all.some((n) => n.props['data-v4-chip-icon'] === 'prompt')).toBe(true)

      const removePromptBtn = all.find(
        (n) => n.type === 'button' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].includes('推轨跟拍'),
      )
      expect(removePromptBtn).toBeDefined()
      ;(removePromptBtn!.props.onClick as () => void)()
      expect(removed).toBe('prompt')
    } finally {
      renderer.close()
    }
  })
})
