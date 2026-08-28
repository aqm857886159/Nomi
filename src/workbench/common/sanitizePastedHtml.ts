// 富文本粘贴清洗：把 Excel / Word 剪贴板里的脏 HTML 洗成 Nomi 编辑器能解析的干净语义结构。
//
// 背景：Tiptap 的 ProseMirror DOMParser 已能解析粘贴的 <table>（Excel 框选）、<h1>/<p>/<ul> 等
// 语义标签，但它会原样带进 Word 的一堆脏东西——`mso-*` 前缀属性、内联 `style`、`class`、
// 分节符、SmartArt、批注等。这些要么产生杂色/杂样式，要么解析成多余空块。
//
// 清洗策略（白名单，不黑名单）：只保留语义标签与基础属性，其余一律剥离。
// 结果与「Word 粘贴保真」的诚实边界对齐：保结构、不保字体/字号/颜色/页眉页脚（见 docs/设计理念）。

/** 允许保留的语义标签（小写）。 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'code',
  'ul', 'ol', 'li',
  'blockquote', 'pre',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'img', 'span', 'div',
])

/** 允许保留的属性（跨所有标签）。colspan/rowspan 让 Excel 合并单元格能保留；colwidth 保留列宽。 */
const ALLOWED_ATTRS = new Set(['href', 'title', 'src', 'alt', 'colspan', 'rowspan', 'colwidth'])

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 清洗粘贴 HTML：剥掉 mso/内联样式/class，只留语义结构。入口给 ProseMirror 的
 * `editorProps.transformPastedHTML` 用。空文档或清洗后为空时返回 ''（让 ProseMirror 走默认纯文本）。
 * 依赖浏览器 DOMParser（渲染进程运行时 API），验证走 R13 真机粘贴走查。
 */
export function sanitizePastedHtml(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('*').forEach((node) => {
    // 1) 丢弃 Word 专属片段：批注、SmartArt、修订、Office 命名空间包裹。
    if (node.namespaceURI && /schemas\.microsoft\.com|urn:schemas-microsoft-com/.test(node.namespaceURI)) {
      node.remove()
      return
    }

    // 2) 属性清洗：只保留白名单属性（href/title/src/alt/colspan/rowspan/colwidth），
    //    其余（mso-*、style、class、align、valign 等）一律剥离。
    Array.from(node.attributes).forEach((attr) => {
      if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) node.removeAttribute(attr.name)
    })

    // 3) 剥离 Word 的换页/分节符伪元素（以 nbsp 填充的空 span）。
    if (node.tagName.toLowerCase() === 'span' && !node.textContent?.trim() && !node.querySelector('img, br')) {
      node.remove()
    }
  })

  // 4) 移除空内容块（Word 常有一串空 <p>&nbsp;</p>；\s 覆盖普通空格与 nbsp）。
  doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach((node) => {
    const text = (node.textContent || '').replace(/\s/g, '')
    if (!text && !node.querySelector('img')) node.remove()
  })

  // 5) 序列化并剥掉保留结构之外的残留标签。
  return serializeAllowed(doc.body).trim()
}

function serializeAllowed(element: Element): string {
  const tag = element.tagName.toLowerCase()
  // 文档根/片段层：直接序列化子节点，不保留容器本身。
  if (tag === 'body' || tag === 'html' || tag === 'div' || tag === 'span') {
    return Array.from(element.childNodes).map(serializeNode).join('')
  }
  return serializeNode(element)
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent || '')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (!ALLOWED_TAGS.has(tag)) {
    // 非白名单标签：保留其子内容，丢弃标签本身（把 Word 的 <o:p> 之类拍平）。
    return Array.from(el.childNodes).map(serializeNode).join('')
  }
  const attrs = Array.from(el.attributes)
    .filter((attr) => ALLOWED_ATTRS.has(attr.name.toLowerCase()))
    .map((attr) => ` ${attr.name}="${escapeHtml(attr.value)}"`)
    .join('')
  const inner = Array.from(el.childNodes).map(serializeNode).join('')
  return `<${tag}${attrs}>${inner}</${tag}>`
}
