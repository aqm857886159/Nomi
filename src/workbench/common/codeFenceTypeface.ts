/**
 * 代码围栏里装的是代码，还是一段要原样复制的文字？——字体只由这里判。
 *
 * 模型给用户一段「可以直接粘去用」的提示词时，也会用 ``` 围起来（为了那颗复制键）。
 * 把这种围栏一律当代码排（等宽 + 不换行），长提示词就被横向截断、读起来像日志
 * （2026-09-25 用户原话：「粘贴框设计有问题吧，为什么这么丑」）。
 *
 * 判据分两步，都不写死某个模型或某段文案：
 *   ① 围栏标了一门语法高亮器认得的**编程语言** → 代码。认不认得由 Streamdown 的代码插件回答
 *      （`supportsLanguage`），不在这里另抄一份语言表。markdown / 纯文本这类「标了也是文字」的语言除外。
 *   ② 没标语言、标的是文字类语言、或标了高亮器不认得的词（`prompt`、`english`…）→ 看内容像不像代码。
 */
export type CodeFenceTypeface = 'code' | 'prose'

/** 高亮器认得、但写出来的仍是人读的文字的围栏语言：它们的内容照样按文字/代码去看。 */
const TEXT_FENCE_LANGUAGES = new Set(['markdown', 'md', 'mdx', 'text', 'txt', 'plain', 'plaintext'])

/** 整段被括号包起来（JSON / 数组 / 对象字面量）。 */
const BRACKETED = /^\s*[[{][\s\S]*[\]}]\s*$/
/** 行尾是 `;` `{` `}`：C 系语法、CSS、JSON 的换行习惯；自然语言句子不这样收尾。 */
const STATEMENT_LINE_END = /[;{}]\s*$/m
/**
 * 行首是小写的声明/控制流/导入关键字，或 shell / REPL 提示符。刻意区分大小写：
 * 英文提示词常以「Create / Import / Return …」开头，那是句子，不是语句。
 */
const STATEMENT_LINE_START = /^\s*(?:import|export|const|let|var|function|def|class|return|if\s*\(|for\s*\(|while\s*\(|#include|package|using)\b|^\s*(?:\$|>>>)\s/m
/** 运算符与标签：箭头函数、全等、逻辑与或、作用域、HTML/XML 标签。 */
const OPERATORS = /=>|[!=]==|&&|\|\||::|<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?>/
/** 代码标点密度阈值：提示词里也有逗号句号，但几乎没有括号、等号、反引号这一族。 */
const SYMBOL_DENSITY = 0.08

export function looksLikeCode(source: string): boolean {
  const text = source.trim()
  if (!text) return false
  if (BRACKETED.test(text) || STATEMENT_LINE_END.test(text) || STATEMENT_LINE_START.test(text) || OPERATORS.test(text)) return true
  const visible = text.replace(/\s+/g, '')
  const symbols = visible.match(/[{}[\]();=<>$`\\|]/g)?.length ?? 0
  return symbols / visible.length > SYMBOL_DENSITY
}

export function codeFenceTypeface(
  language: string,
  source: string,
  isHighlightable: (language: string) => boolean,
): CodeFenceTypeface {
  const fence = language.trim().toLowerCase()
  if (fence && !TEXT_FENCE_LANGUAGES.has(fence) && isHighlightable(fence)) return 'code'
  return looksLikeCode(source) ? 'code' : 'prose'
}
