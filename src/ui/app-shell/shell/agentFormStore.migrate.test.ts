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
  migrateAgentFormV1,
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
    const migrated = migrateAgentFormV1({ bySurface: { creation: { form: 'sidebar', float: { x: 1, y: 2, width: 330, height: 370 }, ball: null } } })
    expect(migrated.bySurface.creation).toEqual({ ...AGENT_FORM_DEFAULTS.creation, float: { x: 1, y: 2, width: 330, height: 370 }, ball: null })
    expect(migrated.bySurface.generation).toEqual({ ...AGENT_FORM_DEFAULTS.generation, float: null, ball: null })
    expect(migrateAgentFormV1(null).bySurface.preview).toEqual({ ...AGENT_FORM_DEFAULTS.preview, float: null, ball: null })
  })
})
