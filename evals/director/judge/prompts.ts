import type { DirectorCard } from '../cardSchema'
import type { Preregistration } from './schema'

export function preregistrationPrompt(card: DirectorCard): string {
  return [
    'You are a blind film-planning reviewer. You can see only the user prompt below.',
    'Before seeing any frames, write the frozen expectation of the video a user should receive.',
    'Use JSON only with this shape: {"cardId":string,"prompt":string,"expectedSegments":[{"timecode":string,"whoWhere":string,"action":string,"framing":string,"camera":string,"cut":string}],"frozenAt":"ISO-8601","sha256":"64 lowercase hex"}.',
    'Use concrete time ranges, subjects and camera changes. Do not invent details that are not implied by the prompt; mark an unconstrained field as "unspecified".',
    `cardId: ${card.id}`,
    `prompt: ${card.prompt}`,
  ].join('\n')
}

export function reviewPrompt(card: DirectorCard, preregistration: Preregistration, frameNames: string[]): string {
  return [
    'You are a blind visual reviewer. You may use only the prompt, the frozen expectation, and the attached frame contact sheet(s).',
    'You cannot inspect code, plans, scores, scheme names, or filenames. Do not infer an event that cannot be confirmed from a frame; use "unclear".',
    'Return JSON only with: {"review":{"segments":[{"timecode":string,"expectation":string,"judgement":"seen|partial|not_seen|unclear","evidence":string}],"userScore":1-5,"leastLike":[{"timecode":string,"problem":string}],"measurableClaims":[{"kind":"direction|shot_size|cut_count|other","value":string,"timecode":string}],"rationale":string},"pairwise":optional}.',
    'Every judgement and least-like item must cite a visible timecode. Use the contact sheet timestamps exactly.',
    `prompt: ${card.prompt}`,
    `frozen expectation: ${JSON.stringify(preregistration.expectedSegments)}`,
    `attached randomized frame files: ${frameNames.join(', ')}`,
  ].join('\n')
}

export function pairwisePrompt(card: DirectorCard, preregistration: Preregistration): string {
  return [
    'You are a blind pairwise film reviewer. Two randomized contact sheets are attached as left and right.',
    'Choose which is closer to the frozen expectation. Use JSON only: {"cardId":string,"leftLabel":"left","rightLabel":"right","winner":"left|right|tie|unclear","why":string}.',
    'Cite timestamps when describing a difference. Do not use filenames to infer identity.',
    `cardId: ${card.id}`,
    `prompt: ${card.prompt}`,
    `frozen expectation: ${JSON.stringify(preregistration.expectedSegments)}`,
  ].join('\n')
}
