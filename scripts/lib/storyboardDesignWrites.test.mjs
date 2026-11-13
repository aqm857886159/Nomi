import { describe, expect, it } from 'vitest'
import { findStoryboardDesignMapWrites } from './storyboardDesignWrites.mjs'

// check:storyboard-owner 第四段：store 之外直接写分镜设计表的四种写法都要被认出来，读不能误报（2026-11-13 独立验收 C6）。
const forms = (source) => findStoryboardDesignMapWrites(source).map((hit) => hit.form)

describe('direct writes to storyboardDesignsByDocumentId', () => {
  it.each([
    ['property', 'useStore.setState({ storyboardDesignsByDocumentId: next })'],
    ['shorthand', 'const storyboardDesignsByDocumentId = {}; useStore.setState({ storyboardDesignsByDocumentId })'],
    ['computed', "useStore.setState({ ['storyboardDesignsByDocumentId']: next })"],
    ['computed', "useStore.setState({ 'storyboardDesignsByDocumentId': next })"],
    ['mutation', "useStore.getState().storyboardDesignsByDocumentId['doc-1'] = designs"],
    ['mutation', 'useStore.getState().storyboardDesignsByDocumentId[id][0].plan.shots[0].durationSec = Number.NaN'],
    ['mutation', "useStore.getState()['storyboardDesignsByDocumentId'][id] = designs"],
    ['mutation', 'delete useStore.getState().storyboardDesignsByDocumentId[id]'],
    ['mutation', 'Object.assign(useStore.getState().storyboardDesignsByDocumentId, patch)'],
    ['mutation', 'useStore.getState().storyboardDesignsByDocumentId[id].push(design)'],
    ['mutation', 'state.storyboardDesignsByDocumentId[id]![0]!.revision++'],
  ])('%s: %s', (form, source) => {
    expect(forms(source)).toEqual([form])
  })

  it.each([
    'const designs = useStore.getState().storyboardDesignsByDocumentId[id]',
    'const { storyboardDesignsByDocumentId } = useStore.getState()',
    'const next = { ...state.storyboardDesignsByDocumentId }',
    'const sorted = state.storyboardDesignsByDocumentId[id].slice().sort(byTitle)',
    'const has = Boolean(state.storyboardDesignsByDocumentId[id]) ? a : b',
    'const pick = (s) => s.storyboardDesignsByDocumentId',
  ])('reading is not a write: %s', (source) => {
    expect(forms(source)).toEqual([])
  })

  it('known blind spot: an alias mutated through a local variable is not seen (needs data flow)', () => {
    expect(forms('const map = useStore.getState().storyboardDesignsByDocumentId; map[id] = designs')).toEqual([])
  })
})
