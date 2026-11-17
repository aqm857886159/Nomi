/**
 * 金额怎么印——面板里**唯一**的一处。
 *
 * 主进程给的是结构化的 `{ amount, currency }`（`electron/shared/contracts/pendingSpendConfirm.ts`
 * 的 `PendingSpendPrice` + `currency`），字符串是在渲染层拼的。原来三处各拼各的
 * （付费卡投影 / 任务卡词表 / 设计实验室），拼法都是 i18n 模板 `{{currency}} {{amount}}`
 * ——于是用户在付钱的那颗按钮上读到的是「生成 CNY 0.30」。货币码不是给人读的。
 *
 * 交给 `Intl.NumberFormat`：它按货币码给符号（CNY → ¥、USD → $），`narrowSymbol` 保证
 * 英文环境下也是「¥0.30」而不是「CN¥0.30」。小数位按货币自己的规矩走（JPY 没有小数），
 * 不再手写 `toFixed(2)`。
 *
 * 货币码不合法时 `Intl` 会抛 RangeError（自建中转报上来的码不归我们管）。那时退回
 * 「码 + 两位小数」——丑，但如实；绝不能让一次格式化失败把整张付费卡渲成空白。
 */
export function formatMoney(locale: string, currency: string, amount: number,
  precision?: Pick<Intl.NumberFormatOptions, 'maximumFractionDigits' | 'maximumSignificantDigits'>,
): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', ...precision }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}
