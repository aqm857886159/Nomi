const AUTO_OPTION_PATTERN = /^(auto|automatic|adaptive|自动|智能)$/i

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
