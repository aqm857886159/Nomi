/** Model-facing progressive disclosure; the generation domain remains the full-data owner. */
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : []
const identifier = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

export function laneGenerationContextText(value: unknown, args: unknown): string {
  const request = record(args)
  const source = record(value)
  const taskKind = identifier(request.taskKind)
  const video = taskKind?.includes('video')
  const image = taskKind?.includes('image') && !video
  const modesFor = (value: unknown) => rows(value).filter(mode => !taskKind || mode.transportTaskKind === taskKind)
  const videoModels: Record<string, unknown>[] = image ? [] : rows(source.videoModels).flatMap(model => {
    const modes = modesFor(model.modes)
    const variants = rows(model.variants).map(variant => ({ ...variant, modes: modesFor(variant.modes) }))
      .filter(variant => !taskKind || variant.modes.length)
    return taskKind && !modes.length && !variants.length ? [] : [{ ...model, modes, variants }]
  })
  const scoped = { ...source,
    ...(image ? { videoModels: [] } : { videoModels }),
    ...(video ? { providerProfiles: [] } : {}),
  }
  if (request.scope === 'full') {
    const full = JSON.stringify(taskKind ? scoped : source, null, 2)
    // Keep tool output bounded even when the caller explicitly asks for full data.
    if (Buffer.byteLength(full, 'utf8') <= 4096) return full
    let out = full
    while (Buffer.byteLength(out, 'utf8') > 4096) out = out.slice(0, Math.floor(out.length * 0.95))
    return out.slice(0, -3) + '...'
  }

  const summary: Record<string, unknown> = {
    scope: 'summary', ...(taskKind ? { taskKind } : {}),
    nextAction: 'Use operation: context, scope: full with taskKind for complete parameters and references; create uses a candidate from this catalog.',
  }
  const models = videoModels.map(model => ({
    providerId: identifier(model.providerId), modelId: identifier(model.modelId), label: identifier(model.label)?.slice(0, 192),
    modes: modesFor(model.modes).map(mode => ({ id: identifier(mode.id), taskKind: identifier(mode.transportTaskKind) })),
    variants: rows(model.variants).map(variant => ({ id: identifier(variant.id),
      modes: modesFor(variant.modes).map(mode => ({ id: identifier(mode.id), taskKind: identifier(mode.transportTaskKind) })),
    })),
  }))
  // Build only complete entries that fit. The disclosure hint is reserved first,
  // so even a huge first catalog item cannot remove the route to full context.
  const profiles = video ? [] : rows(source.providerProfiles).flatMap(profile =>
    (Array.isArray(profile.modelIds) ? profile.modelIds : []).map(modelId => ({
      providerId: identifier(profile.providerId), modelId: identifier(modelId),
    })))
  const candidates = [...models, ...profiles]
  const selected: unknown[] = []
  summary.models = selected
  summary.totalModels = candidates.length
  summary.omittedModels = candidates.length
  for (const candidate of candidates) {
    selected.push(candidate)
    summary.omittedModels = candidates.length - selected.length
    if (Buffer.byteLength(JSON.stringify(summary), 'utf8') > 4096) {
      selected.pop()
      summary.omittedModels = candidates.length - selected.length
      break
    }
  }
  return JSON.stringify(summary)
}
