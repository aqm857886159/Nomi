// 素材面收敛专项测试 · 迁移器（提示词卡 → 主提示词库）。
// 验收门第 5 条：迁移幂等（连续两次不重复）、原桶保留、失败桶可重试、去重键有效。
import { describe, expect, it } from 'vitest'
import {
  LEGACY_BUCKET_PREFIX,
  PROMPTS_MIGRATED_PREFIX,
  collectLegacyBucketKeys,
  migrateLegacyPromptCards,
  parseLegacyPromptCards,
} from './assetSurfaceMigration'

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    dump: () => Object.fromEntries(map),
  }
}

const bucket = (cards: unknown[], categories: unknown[] = []) =>
  JSON.stringify({ version: 1, promptCards: cards, promptCategories: categories, folders: [], folderAssignments: {}, deletedAssetKeys: [] })

const card = (title: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  id: `c-${title}`,
  type: 'prompt',
  source: 'transcript',
  title,
  promptCard: { prompt, promptType: 'image', referenceImages: [], savedAt: '2026-07-01T00:00:00.000Z', ...extra },
})

describe('assetSurfaceMigration · 提示词卡并入主库', () => {
  it('迁移映射：title/prompt/promptType/参考图/自定义分类→tags，原桶保留+写标记', async () => {
    const storage = makeStorage({
      [`${LEGACY_BUCKET_PREFIX}proj-a`]: bucket(
        [
          card('赛博雨夜', 'cyberpunk rainy night', {
            promptType: 'custom:场景',
            referenceImages: [{ url: 'nomi-local://a.png', title: '参考A' }, { url: '' }],
          }),
        ],
        [{ id: 'custom:场景', label: '场景提示词', createdAt: 'x' }],
      ),
    })
    const added: Record<string, unknown>[] = []
    const result = await migrateLegacyPromptCards({
      storage,
      listExistingPrompts: async () => [],
      addPrompt: async (input) => {
        added.push(input)
      },
      now: () => '2026-07-22T00:00:00.000Z',
    })
    expect(result.migratedPrompts).toBe(1)
    expect(added[0]).toMatchObject({
      title: '赛博雨夜',
      prompt: 'cyberpunk rainy night',
      promptType: 'image',
      tags: ['素材盒迁移', '场景提示词'],
    })
    expect((added[0].referenceImages as unknown[]).length).toBe(1)
    expect(storage.getItem(`${PROMPTS_MIGRATED_PREFIX}proj-a`)).toBe('2026-07-22T00:00:00.000Z')
    expect(storage.getItem(`${LEGACY_BUCKET_PREFIX}proj-a`)).not.toBeNull()
  })

  it('幂等：第二次运行（有标记）零迁移零调用', async () => {
    const storage = makeStorage({
      [`${LEGACY_BUCKET_PREFIX}proj-a`]: bucket([card('t', 'p')]),
    })
    const deps = {
      storage,
      listExistingPrompts: async () => [],
      addPrompt: async () => {},
    }
    const first = await migrateLegacyPromptCards(deps)
    expect(first.migratedPrompts).toBe(1)
    let secondRunCalls = 0
    const second = await migrateLegacyPromptCards({
      ...deps,
      addPrompt: async () => {
        secondRunCalls += 1
      },
    })
    expect(second.scannedBuckets).toBe(0)
    expect(second.migratedPrompts).toBe(0)
    expect(secondRunCalls).toBe(0)
  })

  it('去重：主库已有同 title+prompt 的条目不重复迁；多桶同卡只迁一次', async () => {
    const storage = makeStorage({
      [`${LEGACY_BUCKET_PREFIX}proj-a`]: bucket([card('同卡', 'same prompt'), card('库里已有', 'existing prompt')]),
      [`${LEGACY_BUCKET_PREFIX}proj-b`]: bucket([card('同卡', 'same prompt')]),
    })
    const added: Record<string, unknown>[] = []
    const result = await migrateLegacyPromptCards({
      storage,
      listExistingPrompts: async () => [{ title: '库里已有', prompt: 'existing prompt' }],
      addPrompt: async (input) => {
        added.push(input)
      },
    })
    expect(result.migratedPrompts).toBe(1)
    expect(result.duplicatesSkipped).toBe(2)
    expect(added.map((item) => item.title)).toEqual(['同卡'])
  })

  it('失败桶不写标记（下次重试），坏 JSON 桶不崩', async () => {
    const storage = makeStorage({
      [`${LEGACY_BUCKET_PREFIX}proj-bad`]: '{not json',
      [`${LEGACY_BUCKET_PREFIX}proj-fail`]: bucket([card('会失败', 'boom')]),
    })
    const result = await migrateLegacyPromptCards({
      storage,
      listExistingPrompts: async () => [],
      addPrompt: async () => {
        throw new Error('ipc down')
      },
    })
    expect(result.errors).toBe(1)
    expect(storage.getItem(`${PROMPTS_MIGRATED_PREFIX}proj-fail`)).toBeNull()
    expect(storage.getItem(`${PROMPTS_MIGRATED_PREFIX}proj-bad`)).not.toBeNull()
  })

  it('collectLegacyBucketKeys / parseLegacyPromptCards 宽松容错', () => {
    const storage = makeStorage({
      [`${LEGACY_BUCKET_PREFIX}p1`]: bucket([]),
      'unrelated-key': 'x',
    })
    expect(collectLegacyBucketKeys(storage)).toEqual([`${LEGACY_BUCKET_PREFIX}p1`])
    expect(parseLegacyPromptCards(null)).toEqual([])
    expect(parseLegacyPromptCards('{}')).toEqual([])
    expect(parseLegacyPromptCards(bucket([{ promptCard: { prompt: '   ' } }]))).toEqual([])
  })
})
