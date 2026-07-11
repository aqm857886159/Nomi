import type { TaskResultDto } from '../../../workbench/api/taskApi'

export type BrowserPromptExtraction = {
  title: string
  prompt: string
}

export type BrowserPromptExtractionMode = 'replicate' | 'style'

export const BROWSER_PROMPT_EXTRACTION_MODE_LABELS: Record<BrowserPromptExtractionMode, string> = {
  replicate: '画面复刻',
  style: '画面风格',
}

export const BROWSER_IMAGE_REPLICATE_PROMPT_EXTRACTION_PROMPT = [
  '你是 Nomi 的资深 AI 视觉提示词工程师，擅长把参考图拆解为可复现的图片生成提示词。',
  '目标：根据用户提供的参考图，生成高保真、商业安全、可编辑的图片提示词。优先忠实还原可见画面，不猜测不可见信息。',
  '安全原则：如果画面疑似包含品牌、名人、版权角色或在世艺术家风格，只描述可观察的中性视觉特征，不要求复制受保护身份、标志或风格。',
  '分析维度：主体、数量、姿态/朝向、构图与空间关系、镜头/视角、光线方向与质感、阴影/反射、色彩、材质纹理、环境背景、道具、可见文字位置、画面情绪、风格、画幅比例线索。',
  '请同时给出简体中文和英文结果；简体中文 faithful 提示词需要最详细，约 180-320 个中文字符，足够让另一个图片模型重建画面。',
  'negativePrompt 用于减少低质量、结构错误、错误文字、多余物体、模糊、坏裁切、过饱和和生成瑕疵。',
  '只返回 JSON，不要 Markdown，不要代码块。JSON 结构：',
  '{',
  '  "title": "8个字以内的图片主题",',
  '  "localizedTitles": { "en": "English topic under 8 words", "zh-CN": "8个字以内中文主题" },',
  '  "summary": "一句话概括画面和必须保留的视觉重点",',
  '  "prompts": {',
  '    "faithful": "高保真还原提示词，覆盖主体、构图、光线、材质、背景、镜头和细节",',
  '    "commercial": "商业可用提示词，保留相同主体、构图、光线和细节层级",',
  '    "creative": "更有创意但仍保留核心主体、构图、色彩、光线和材质线索的提示词"',
  '  },',
  '  "platformPrompts": {',
  '    "openai": "适合 OpenAI 图片模型的自然语言高细节提示词",',
  '    "midjourney": "English Midjourney prompt with useful parameters such as --ar when inferable",',
  '    "flux": "clear Flux reconstruction prompt emphasizing subject, material, lighting, composition, and texture",',
  '    "stableDiffusion": "positive Stable Diffusion prompt without negative terms"',
  '  },',
  '  "localizedPrompts": {',
  '    "en": { "faithful": "English faithful prompt", "commercial": "English commercial prompt", "creative": "English creative prompt" },',
  '    "zh-CN": { "faithful": "简体中文高保真还原提示词", "commercial": "简体中文商业提示词", "creative": "简体中文创意提示词" }',
  '  },',
  '  "components": {',
  '    "subject": "主体和动作",',
  '    "composition": "构图和镜头",',
  '    "lighting": "光线",',
  '    "color": "色彩",',
  '    "material": "材质纹理",',
  '    "background": "背景环境",',
  '    "style": "视觉风格"',
  '  },',
  '  "negativePrompt": "low quality, blurry, distorted, extra objects, wrong text, bad crop, oversaturation, artifacts",',
  '  "promptType": "image"',
  '}',
].join('\n')

export const BROWSER_IMAGE_PROMPT_EXTRACTION_PROMPT = BROWSER_IMAGE_REPLICATE_PROMPT_EXTRACTION_PROMPT

export const BROWSER_IMAGE_STYLE_PROMPT_EXTRACTION_PROMPT = [
  '你是 Nomi 的资深视觉风格分析师，擅长把参考图拆解为可迁移、可复用的视觉风格规格。',
  '目标：将这张图的视觉风格提取为 JSON 结构数据：配色、字体、构图、效果等。',
  '只分析可观察的视觉风格，不复刻品牌标志、名人身份、版权角色或在世艺术家的个人风格。',
  '不要描述需要保留的具体主体身份；重点提取可迁移的设计语言、镜头语言、质感和氛围。',
  '只返回 JSON，不要 Markdown，不要代码块。JSON 结构：',
  '{',
  '  "title": "8个字以内的风格名称",',
  '  "summary": "一句话概括整体视觉风格",',
  '  "stylePrompt": "可直接用于生成相同视觉风格的中文提示词，强调配色、字体、构图、效果、光影、材质、氛围，不绑定原图主体",',
  '  "style": {',
  '    "colorPalette": [{ "name": "颜色名称", "hex": "#RRGGBB", "usage": "用途" }],',
  '    "typography": { "fontStyle": "字体风格", "weight": "字重", "spacing": "字距/排版节奏", "textTreatment": "文字效果" },',
  '    "composition": { "layout": "版式结构", "framing": "取景/留白", "hierarchy": "视觉层级", "balance": "平衡方式" },',
  '    "lighting": { "direction": "光线方向", "contrast": "明暗对比", "mood": "光影情绪" },',
  '    "materials": ["材质和纹理"],',
  '    "effects": ["后期/滤镜/特效/颗粒/模糊/描边等"],',
  '    "mood": "氛围关键词",',
  '    "dos": ["复用该风格时应该保留的规则"],',
  '    "donts": ["复用该风格时应避免的偏差"]',
  '  },',
  '  "promptType": "image",',
  '  "extractionMode": "style"',
  '}',
].join('\n')

export function browserPromptExtractionPromptForMode(mode: BrowserPromptExtractionMode): string {
  return mode === 'style'
    ? BROWSER_IMAGE_STYLE_PROMPT_EXTRACTION_PROMPT
    : BROWSER_IMAGE_REPLICATE_PROMPT_EXTRACTION_PROMPT
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asTrimmedString(value)
    if (text) return text
  }
  return ''
}

function textFromContentParts(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      return firstText(record.text, record.content, record.output_text)
    })
    .filter(Boolean)
    .join('')
    .trim()
}

export function extractTextFromTaskResult(result: TaskResultDto): string {
  if (!result || result.status !== 'succeeded') return ''
  const raw = result.raw
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as Record<string, unknown>
  const direct = firstText(record.output_text, record.text)
  if (direct) return direct

  const choices = record.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown> | undefined
    const message = first?.message as Record<string, unknown> | undefined
    const messageText = textFromContentParts(message?.content)
    if (messageText) return messageText
    const legacyText = firstText(first?.text)
    if (legacyText) return legacyText
  }

  const output = record.output
  if (Array.isArray(output)) {
    const outputText = output
      .map((item) => {
        if (!item || typeof item !== 'object') return ''
        const itemRecord = item as Record<string, unknown>
        return textFromContentParts(itemRecord.content)
      })
      .filter(Boolean)
      .join('\n')
      .trim()
    if (outputText) return outputText
  }

  return textFromContentParts(record.content)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const normalized = text.trim()
  if (!normalized) return null
  const jsonText = normalized.startsWith('{')
    ? normalized
    : normalized.slice(normalized.indexOf('{'), normalized.lastIndexOf('}') + 1)
  if (!jsonText.startsWith('{') || !jsonText.endsWith('}')) return null
  try {
    const parsed = JSON.parse(jsonText)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function promptFromNestedAnalysis(record: Record<string, unknown>): string {
  const localizedPrompts = record.localizedPrompts as Record<string, unknown> | undefined
  const zhPrompts = localizedPrompts?.['zh-CN'] as Record<string, unknown> | undefined
  const prompts = record.prompts as Record<string, unknown> | undefined
  const platformPrompts = record.platformPrompts as Record<string, unknown> | undefined
  return firstText(
    record.prompt,
    zhPrompts?.faithful,
    zhPrompts?.commercial,
    prompts?.faithful,
    prompts?.commercial,
    platformPrompts?.openai,
  )
}

function stylePromptFromAnalysis(record: Record<string, unknown>): string {
  const formatted = JSON.stringify(record, null, 2)
  return formatted || firstText(record.stylePrompt, record.prompt)
}

export function parseBrowserPromptExtraction(
  text: string,
  mode: BrowserPromptExtractionMode = 'replicate',
): BrowserPromptExtraction {
  const parsed = parseJsonObject(text)
  if (parsed) {
    const prompt = mode === 'style' ? stylePromptFromAnalysis(parsed) : promptFromNestedAnalysis(parsed)
    if (prompt) {
      return {
        title:
          firstText(parsed.title, (parsed.localizedTitles as Record<string, unknown> | undefined)?.['zh-CN']) ||
          (mode === 'style' ? '画面风格' : '图片提示词'),
        prompt,
      }
    }
  }
  const fallback = text.trim()
  return {
    title: mode === 'style' ? '画面风格' : '图片提示词',
    prompt: fallback,
  }
}
