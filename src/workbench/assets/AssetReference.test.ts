import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import AssetReference, { type AssetSlot } from './AssetReference'

vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

/** 行首「+」工具钮此刻能不能点（SSR 里灰掉的钮带 disabled）。 */
function addEntryEnabled(html: string): boolean {
  const tag = html.match(/<button[^>]*data-reference-add-entry="true"[^>]*>/)?.[0] ?? ''
  return tag !== '' && !/\sdisabled(=|\s|>)/.test(tag)
}

describe('reference capacity rendering', () => {
  it.each([
    { max: undefined, occupied: 20, canAdd: true },
    { max: 3, occupied: 3, canAdd: false },
    { max: 3, occupied: 2, canAdd: true },
  ])('keeps unknown caps usable and respects occupied positions: $max / $occupied', ({ max, occupied, canAdd }) => {
    const slot: AssetSlot = {
      key: 'refs', label: 'References', accept: 'image', form: 'array',
      persistAsEdge: true, numbered: true, max,
    }
    const html = renderToStaticMarkup(React.createElement(AssetReference, {
      slots: [slot], valuesByKey: { refs: [] }, occupiedByKey: { refs: occupied },
      projectId: null, openSlotKey: '', uploadingSlotKey: '',
      onTogglePicker: vi.fn(), onPick: vi.fn(), onUpload: vi.fn(), onRemove: vi.fn(),
    }))
    // 「+」是行首的工具钮（B3）：能再加就可点，满了就灰掉；数组里不再有第二个「+」格。
    expect(addEntryEnabled(html)).toBe(canAdd)
    expect(html).not.toContain('data-asset-add-tile="true"')
  })
})

describe('existing slot add buttons remain the only library entrances', () => {
  const single=(key:string):AssetSlot=>({key,label:key,accept:'image',form:'single',persistAsEdge:true,numbered:false})
  const array:AssetSlot={...single('refs'),form:'array',max:3}
  it.each([
    {name:'empty image references',slots:[array],values:{refs:[]},adds:0,entry:true},
    {name:'populated image references',slots:[array],values:{refs:['a.jpg']},adds:0,entry:true},
    {name:'empty first and last frame',slots:[single('first'),single('last')],values:{},adds:2,entry:true},
    {name:'first frame already filled',slots:[single('first'),single('last')],values:{first:'a.jpg'},adds:1,entry:true},
    {name:'filled single source',slots:[single('source')],values:{source:'a.jpg'},adds:0,entry:false},
    // 首尾帧两格都满：「+」仍在、灰显（悬停写已放满），和参考数组满额同一套（验收阻断 4）
    {name:'both frames filled',slots:[single('first'),single('last')],values:{first:'a.jpg',last:'b.jpg'},adds:0,entry:false,present:true},
  ])('$name has one add entry plus the empty cells only',(row)=>{
    const {slots,values,adds,entry}=row
    const present='present' in row&&row.present
    const html=renderToStaticMarkup(React.createElement(AssetReference,{
      slots,valuesByKey:values as Record<string,string|string[]>,projectId:null,openSlotKey:'',uploadingSlotKey:'',
      onTogglePicker:vi.fn(),onPick:vi.fn(),onUpload:vi.fn(),onRemove:vi.fn(),onPickOnCanvas:vi.fn(),
    }))
    expect(html).toContain('data-reference-entry="true"')
    expect(html).not.toContain('data-reference-add=')
    expect(html.match(/data-asset-add-tile="true"/g)?.length??0).toBe(adds)
    expect(addEntryEnabled(html)).toBe(entry)
    if (present) expect(html).toMatch(/<button[^>]*data-reference-add-entry="true"[^>]*disabled/)
  })
})

describe('first-frame tag on the array slot', () => {
  const slot: AssetSlot = { key: 'refs', label: 'References', accept: 'image', form: 'array', persistAsEdge: false, numbered: false }
  const render = (firstFrameSlotKey?: string) => renderToStaticMarkup(React.createElement(AssetReference, {
    slots: [slot], valuesByKey: { refs: ['https://cdn/a.png', 'https://cdn/b.png'] },
    projectId: null, openSlotKey: '', uploadingSlotKey: '',
    onTogglePicker: vi.fn(), onPick: vi.fn(), onUpload: vi.fn(), onRemove: vi.fn(),
    ...(firstFrameSlotKey ? { firstFrameSlotKey } : {}),
  }))
  it('marks only the first tile of the named slot', () => {
    const html = render('refs')
    expect(html.match(/data-asset-tile-tag="firstFrame"/g)?.length).toBe(1)
    expect(html).toContain('generationCommon.parameters.firstFrame')
  })
  it('no tag when the slot is not named', () => {
    expect(render()).not.toContain('data-asset-tile-tag')
  })
})

describe('「+」由宿主的判据给类（addEntry）', () => {
  const array: AssetSlot = { key: 'refs', label: 'References', accept: 'image', form: 'array', persistAsEdge: true, numbered: false, max: 30 }
  const render = (accept: readonly ('image' | 'video' | 'audio')[], slots: AssetSlot[] = [array]) => renderToStaticMarkup(React.createElement(AssetReference, {
    slots, valuesByKey: { refs: [] }, projectId: null, openSlotKey: '', uploadingSlotKey: '',
    onTogglePicker: vi.fn(), onPick: vi.fn(), onUpload: vi.fn(), onRemove: vi.fn(), onPickOnCanvas: vi.fn(),
    addEntry: { accept, onAsset: vi.fn(), onUpload: vi.fn() },
  }))
  it.each([
    { name: '还能放：可点', accept: ['image', 'audio'] as const, enabled: true },
    // 一类都放不下（模型到上限）：「+」还在、灰着、悬停写放满了（拍板图 K1 / 验收阻断 4 同一套），点不开选择器。
    { name: '一类都放不下：灰着但还在', accept: [] as const, enabled: false },
  ])('$name', ({ accept, enabled }) => {
    const html = render(accept)
    expect(html).toContain('data-reference-add-entry="true"')
    expect(addEntryEnabled(html)).toBe(enabled)
  })
  it('文生视频（一格都没有）也有「+」：放什么由判据定', () => {
    expect(addEntryEnabled(render(['image', 'video', 'audio'], []))).toBe(true)
  })
})
