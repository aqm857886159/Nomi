import i18n from '../../../i18n'

export function buildOptimizePrompt(original: string, idea: string, isVideo: boolean): string {
  const kind = i18n.t(isVideo ? 'generationCommon.optimizer.videoKind' : 'generationCommon.optimizer.imageKind')
  return [
    i18n.t('generationCommon.optimizer.intro', {
      kind,
      resultType: i18n.t(isVideo ? 'generationCommon.optimizer.videoResult' : 'generationCommon.optimizer.imageResult'),
    }),
    `"""\n${original || i18n.t('generationCommon.optimizer.blank')}\n"""`,
    idea ? i18n.t('generationCommon.optimizer.idea', { idea }) : '',
    i18n.t(isVideo ? 'generationCommon.optimizer.videoDetails' : 'generationCommon.optimizer.imageDetails'),
    isVideo ? i18n.t('generationCommon.optimizer.pollutionRule') : '',
    i18n.t('generationCommon.optimizer.outputRule'),
  ].filter(Boolean).join('\n')
}
