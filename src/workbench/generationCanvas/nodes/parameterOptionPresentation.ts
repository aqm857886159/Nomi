import { normalizeAspectRatioToWH } from './aspectRatio'

const AUTO_OPTION_PATTERN = /^(auto|automatic|adaptive|自动|智能)$/i

type ParameterOption = { value: string; text: string }

export type ParameterOptionPurpose = 'generic' | 'aspect-ratio' | 'provider'

export type LocalizedParameterOption = {
  value: string
  text: string
  isAuto: boolean
}

/** 内部参数值保持供应商无关，只把自动语义收敛到当前语言的展示文字。 */
export function localizeAutoOption(
  value: string,
  text: string,
  autoLabel: string,
): LocalizedParameterOption {
  const isAuto = AUTO_OPTION_PATTERN.test(value.trim()) || AUTO_OPTION_PATTERN.test(text.trim())
  return { value, text: isAuto ? autoLabel : text, isAuto }
}

/** Semantic roles stay stable across models; only generic enums use overflow heuristics. */
export function resolveParameterOptionPurpose(
  options: readonly ParameterOption[],
  requested: ParameterOptionPurpose = 'generic',
): ParameterOptionPurpose {
  if (requested !== 'generic') return requested
  const explicitOptions = options.filter(({ value, text }) => (
    !AUTO_OPTION_PATTERN.test(value.trim()) && !AUTO_OPTION_PATTERN.test(text.trim())
  ))
  const allRatios = explicitOptions.length > 0 && explicitOptions.every(({ value, text }) => (
    normalizeAspectRatioToWH(value) !== null || normalizeAspectRatioToWH(text) !== null
  ))
  return allRatios ? 'aspect-ratio' : 'generic'
}

/** Segments are for short, scannable choices. Filename/large enums need a searchable list. */
export function parameterOptionLayout(
  options: readonly { text: string }[],
  purpose: ParameterOptionPurpose = 'generic',
): 'segmented' | 'select' {
  if (purpose !== 'generic') return 'segmented'
  if (options.length > 12) return 'select'
  // At the panel's minimum segment width, full-width glyphs consume about two ASCII cells.
  const fits = options.every(({ text }) => Array.from(text).reduce((width, char) => width + ((char.codePointAt(0) ?? 0) > 255 ? 2 : 1), 0) <= 8)
  return fits ? 'segmented' : 'select'
}
