// 老用户升级（设计卡 docs/plan/2026-11-14-agent-form-restructure.md ★1c）：0.24.1 存下的每页三值 `form`
// → 摆法 + 收没收起。夹具是 0.24.1 自己的 store 落出来的那一串（tests/fixtures/old-user-data/agent-form/）。
// 量的是创作者升级后那一刻：每页看到的和升级前一样；之后点开回到哪；浮窗位置大小、小球位置一个不丢；迁完再存再读逐字相等。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_FORM_DEFAULTS,
  AGENT_FORM_STORAGE_KEY,
  AGENT_FORM_STORAGE_VERSION,
  normalizeStoredAgentForm,
  openAgent,
  shownForm,
  useAgentFormStore,
  type AgentFormSurface,
} from './agentFormStore'
import { useAgentFormViewStore } from './agentFormViewStore'

const disk = vi.hoisted(() => {
  const map = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      clear: () => void map.clear(),
    },
  })
  return map
})

const FIXTURES = fileURLToPath(new URL('../../../../tests/fixtures/old-user-data/agent-form/v0.24.1-local-storage/', import.meta.url))
const SURFACES: AgentFormSurface[] = ['creation', 'storyboard', 'generation', 'preview']
type OldForm = 'ball' | 'float' | 'dock'
type OldEntry = { form: OldForm; float: unknown; ball: unknown }

const readBlob = (name: string): string => readFileSync(`${FIXTURES}${name}.json`, 'utf8').trim()
const oldEntries = (blob: string): Record<AgentFormSurface, OldEntry> => (JSON.parse(blob) as { state: { bySurface: Record<AgentFormSurface, OldEntry> } }).state.bySurface

/** 像重开应用：内存回到初始，再从磁盘那一串读（换回初始那一下 persist 会写盘，先留住磁盘那份）。 */
async function launchWith(blob: string | null): Promise<void> {
  useAgentFormViewStore.setState(useAgentFormViewStore.getInitialState(), true)
  useAgentFormStore.setState(useAgentFormStore.getInitialState(), true)
  disk.clear()
  if (blob !== null) disk.set(AGENT_FORM_STORAGE_KEY, blob)
  await useAgentFormStore.persist.rehydrate()
}

beforeEach(() => disk.clear())

describe('0.24.1 的 Nomi 形态升级：3 种旧值 × 4 页 = 12 格', () => {
  for (const name of ['all-ball', 'all-float', 'all-dock'] as const) {
    const blob = readBlob(name)
    const old = oldEntries(blob)
    for (const surface of SURFACES) {
      const form = old[surface].form
      it(`${name} · ${surface}（旧 ${form}）：升级后看到的一样，摆法 / 收起对，位置大小原样`, async () => {
        await launchWith(blob)
        const prefs = useAgentFormStore.getState().bySurface[surface]
        expect(shownForm(surface)).toBe(form)
        expect(prefs.collapsed).toBe(form === 'ball')
        // 旧小球：再点开去旧版点开会去的地方（这一页的默认摆法）；旧浮窗 / 停靠：就是那个摆法。
        expect(prefs.placement).toBe(form === 'ball' ? AGENT_FORM_DEFAULTS[surface].placement : form)
        expect(prefs.float).toEqual(old[surface].float)
        expect(prefs.ball).toEqual(old[surface].ball)
        openAgent(surface)
        expect(shownForm(surface)).toBe(form === 'ball' ? AGENT_FORM_DEFAULTS[surface].placement : form)
      })
    }
  }

  it('各页不同（含一页没动过）：逐页各迁各的，不串页', async () => {
    const blob = readBlob('mixed')
    const old = oldEntries(blob)
    await launchWith(blob)
    for (const surface of SURFACES) {
      expect(shownForm(surface), surface).toBe(old[surface].form)
      expect(useAgentFormStore.getState().bySurface[surface].float, surface).toEqual(old[surface].float)
    }
  })

  for (const name of ['all-ball', 'all-float', 'all-dock', 'mixed'] as const) {
    it(`${name}：迁完落回磁盘是新版本、没有旧 form；再存再读逐字相等`, async () => {
      await launchWith(readBlob(name))
      const migrated = disk.get(AGENT_FORM_STORAGE_KEY)!
      const parsed = JSON.parse(migrated) as { version: number; state: { bySurface: Record<string, Record<string, unknown>> } }
      expect(parsed.version).toBe(AGENT_FORM_STORAGE_VERSION)
      for (const surface of SURFACES) expect(Object.keys(parsed.state.bySurface[surface]).sort()).toEqual(['ball', 'collapsed', 'float', 'placement'])
      const stateAfterFirst = useAgentFormStore.getState().bySurface
      await launchWith(migrated)
      expect(useAgentFormStore.getState().bySurface).toEqual(stateAfterFirst)
      // 读新版那一串不迁移、不回写：磁盘还是那一串。
      expect(disk.get(AGENT_FORM_STORAGE_KEY)).toBe(migrated)
    })
  }

  it('从没存过（新用户）：各页默认，磁盘不写', async () => {
    await launchWith(null)
    for (const surface of SURFACES) expect(useAgentFormStore.getState().bySurface[surface]).toMatchObject(AGENT_FORM_DEFAULTS[surface])
    expect(disk.has(AGENT_FORM_STORAGE_KEY)).toBe(false)
  })

  it('认不出的旧值、缺页：按这一页的默认，位置照留', () => {
    const migrated = normalizeStoredAgentForm({ bySurface: { creation: { form: 'sidebar', float: { x: 1, y: 2, width: 330, height: 370 }, ball: null } } }, 1)
    expect(migrated.bySurface.creation).toEqual({ ...AGENT_FORM_DEFAULTS.creation, float: { x: 1, y: 2, width: 330, height: 370 }, ball: null })
    expect(migrated.bySurface.generation).toEqual({ ...AGENT_FORM_DEFAULTS.generation, float: null, ball: null })
    expect(normalizeStoredAgentForm(null, 1).bySurface.preview).toEqual({ ...AGENT_FORM_DEFAULTS.preview, float: null, ball: null })
  })
})

// ── 新格式存档坏了（独立验收条件 2）：四种坏法 × 四页。每页读出来都是合法形状，坏的那页回到默认、好的那几页保住；读不写回 ──────
type Kind = 'missing-page' | 'unknown-values' | 'non-number-geometry' | 'not-an-object'
const KINDS: Kind[] = ['missing-page', 'unknown-values', 'non-number-geometry', 'not-an-object']
/** 好的那一份：每页都和默认不同（创作浮窗收着、分镜浮窗开着、生成停靠开着、预览停靠收着），保没保住一眼看得出。 */
const GOOD: Record<AgentFormSurface, { placement: 'float' | 'dock'; collapsed: boolean; float: unknown; ball: unknown }> = {
  creation: { placement: 'float', collapsed: true, float: { x: 10, y: 20, width: 330, height: 370 }, ball: { x: 5, y: 6 } },
  storyboard: { placement: 'float', collapsed: false, float: null, ball: null },
  generation: { placement: 'dock', collapsed: false, float: null, ball: { x: 7, y: 8 } },
  preview: { placement: 'dock', collapsed: true, float: null, ball: null },
}

function badV2Blob(kind: Kind, bad: AgentFormSurface): string {
  if (kind === 'not-an-object') return JSON.stringify({ state: { bySurface: 'broken' }, version: AGENT_FORM_STORAGE_VERSION })
  const bySurface: Record<string, unknown> = { ...GOOD }
  if (kind === 'missing-page') delete bySurface[bad]
  if (kind === 'unknown-values') bySurface[bad] = { ...GOOD[bad], placement: 'sidebar', collapsed: 'yes' }
  if (kind === 'non-number-geometry') bySurface[bad] = { ...GOOD[bad], float: { x: 'a', y: 1, width: 300, height: null }, ball: { x: '3', y: 4 } }
  return JSON.stringify({ state: { bySurface }, version: AGENT_FORM_STORAGE_VERSION })
}

describe('新格式存档坏了：四种坏法 × 四页 = 16 格，每页合法、好的保住、读不写回', () => {
  for (const kind of KINDS) {
    for (const bad of SURFACES) {
      it(`${kind} · 坏在 ${bad}`, async () => {
        const blob = badV2Blob(kind, bad)
        await launchWith(blob)
        for (const surface of SURFACES) {
          const prefs = useAgentFormStore.getState().bySurface[surface]
          expect(prefs, `${surface} 这一页在`).toBeDefined()
          expect(['float', 'dock'], `${surface} 摆法`).toContain(prefs.placement)
          expect(typeof prefs.collapsed, `${surface} 收没收起`).toBe('boolean')
          expect(prefs.float === null || [prefs.float.x, prefs.float.y, prefs.float.width, prefs.float.height].every(Number.isFinite), `${surface} 浮窗`).toBe(true)
          expect(prefs.ball === null || [prefs.ball.x, prefs.ball.y].every(Number.isFinite), `${surface} 小球`).toBe(true)
          expect(['ball', 'float', 'dock']).toContain(shownForm(surface))
          const whole = kind === 'not-an-object'
          if (whole || (surface === bad && kind === 'missing-page')) {
            expect(prefs, `${surface} 回到这一页的默认`).toEqual({ ...AGENT_FORM_DEFAULTS[surface], float: null, ball: null })
          } else if (surface === bad && kind === 'unknown-values') {
            expect(prefs, `${surface} 认不出的值回到默认、位置保住`).toEqual({ ...AGENT_FORM_DEFAULTS[surface], float: GOOD[surface].float, ball: GOOD[surface].ball })
          } else if (surface === bad) {
            expect(prefs, `${surface} 摆法保住、坏的位置丢掉`).toEqual({ placement: GOOD[surface].placement, collapsed: GOOD[surface].collapsed, float: null, ball: null })
          } else {
            expect(prefs, `${surface} 好的那页原样`).toEqual(GOOD[surface])
          }
        }
        // 规整不写回：打开不点就关，磁盘还是那一串。
        expect(disk.get(AGENT_FORM_STORAGE_KEY)).toBe(blob)
      })
    }
  }

  it('整段读不出来（不是 JSON / 不是对象 / 是 null）：各页默认，不写回', async () => {
    for (const blob of ['{not json', '5', JSON.stringify({ state: 7, version: AGENT_FORM_STORAGE_VERSION }), JSON.stringify({ state: { bySurface: null }, version: AGENT_FORM_STORAGE_VERSION })]) {
      await launchWith(blob)
      for (const surface of SURFACES) expect(useAgentFormStore.getState().bySurface[surface], `${blob} · ${surface}`).toEqual({ ...AGENT_FORM_DEFAULTS[surface], float: null, ball: null })
      expect(disk.get(AGENT_FORM_STORAGE_KEY)).toBe(blob)
    }
  })
})
