import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import type { NomiEditorCodec, NomiEditorOwner, useNomiTiptapEditor } from './useNomiRichTextEditor'

/**
 * 编辑器唯一入口在**类型上**收不进初始内容（2026-11-21，#1573 换方向）：「建出一个拿着旧副本的编辑器」
 * 要在编译这一步就写不出来，而不是等走查发现框里是旧字。入口只认 owner（subscribe / getSnapshot / write），
 * 每个实例出生时自己调 getSnapshot() 读真值。
 *
 * 守法：下面每一行 `@ts-expect-error` 都是一次「往入口里塞旧值」的写法。入口哪天重新接受它，
 * 这一行就不再报错，`@ts-expect-error` 变成未使用的指令（TS2578），`pnpm run check:test-types` 变红。
 * 只看类型，不运行：函数体永远不被调用。
 */
declare const entry: typeof useNomiTiptapEditor
declare const owner: NomiEditorOwner<string>
declare const codec: NomiEditorCodec<string>
declare const frozen: JSONContent

export function attemptsToHandAStaleCopy(): void {
  // owner + 编解码 + 扩展：合法。
  entry({ owner, codec, extensions: [] })
  // @ts-expect-error 入口不收初始内容：每个实例出生时由入口按 owner.getSnapshot() 造文档
  entry({ owner, codec, extensions: [], content: frozen })
  // @ts-expect-error 入口不收渲染时的值：渲染拿到的可能是旧副本，真值只从 owner 读
  entry({ owner, codec, extensions: [], value: 'stale' })
  // @ts-expect-error 入口不收 onUpdate：回写只经 owner.write（带防回写的账）
  entry({ owner, codec, extensions: [], onUpdate: () => undefined })
  // @ts-expect-error 入口不收 onBeforeCreate：那是能在实例出生前改掉 content 的口
  entry({ owner, codec, extensions: [], onBeforeCreate: () => undefined })
  // @ts-expect-error 入口不收 onCreate：那是能在实例出生后立刻灌进旧值的口
  entry({ owner, codec, extensions: [], onCreate: () => undefined })
  // @ts-expect-error 没有 owner 就建不出编辑器
  entry({ codec, extensions: [] })
}

describe('useNomiTiptapEditor 的参数类型', () => {
  it('只在类型检查里起作用（check:test-types）；运行时只确认这份守法文件被测试车道收着', () => {
    expect(typeof attemptsToHandAStaleCopy).toBe('function')
  })
})
