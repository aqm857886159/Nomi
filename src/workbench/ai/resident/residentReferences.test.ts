import { expect, it } from 'vitest'

it('stable plan references keep the selected shot across reorder and reject another plan',async()=>{
  const api=await import('./residentReferences')
  const ref=api.buildStoryboardReference('Shot 1',{documentId:'doc',designId:'plan-a',shot:{index:1,shotId:'stable-a'}})
  expect(api.storyboardShotIdsForTarget([ref],{documentId:'doc',designId:'plan-a'})).toEqual(['stable-a'])
  expect(()=>api.storyboardShotIdsForTarget([ref],{documentId:'doc',designId:'plan-b'})).toThrow(/target/)
})

it.each([1, 3])('manual shots without explicit ids retain %i stable plan identities', async count => {
  const api = await import('./residentReferences')
  const references = Array.from({ length: count }, (_, index) => api.buildStoryboardReference(`Shot ${index + 1}`, {
    documentId: 'doc', designId: 'manual-plan', shot: { index: index + 1 },
  }))
  expect(api.storyboardShotIdsForTarget(references, { documentId: 'doc', designId: 'manual-plan' }))
    .toEqual(Array.from({ length: count }, (_, index) => `shot-${index + 1}`))
  expect(() => api.storyboardShotIdsForTarget(references, { documentId: 'other', designId: 'manual-plan' })).toThrow(/target/)
})
