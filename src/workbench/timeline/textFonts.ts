/**
 * 文字叠加层可选字体（按 id 存，渲染时解析成 CSS font stack）。
 * 用系统自带 CJK 字体（不绑字体文件）——预览(Chromium DOM) 与导出(离屏 canvas) 同一套渲染，零漂移。
 * 字体栈都带 macOS / Windows 回退，保证中文可读。
 */
export type TextFontId = 'default' | 'songti' | 'kaiti' | 'yuanti' | 'serif-en'

export type TextFontOption = { id: TextFontId; label: string; stack: string }

export const TEXT_FONTS: TextFontOption[] = [
  { id: 'default', label: '默认黑体', stack: 'Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif' },
  { id: 'songti', label: '宋体', stack: '"Songti SC", "STSong", "SimSun", "Source Han Serif SC", serif' },
  { id: 'kaiti', label: '楷体', stack: '"Kaiti SC", "STKaiti", "KaiTi", serif' },
  { id: 'yuanti', label: '圆体', stack: '"Yuanti SC", "PingFang SC", system-ui, sans-serif' },
  { id: 'serif-en', label: '英文衬线', stack: 'Georgia, "Times New Roman", "Songti SC", serif' },
]

export const DEFAULT_TEXT_FONT_ID: TextFontId = 'default'

export function resolveFontStack(fontId: string | undefined): string {
  return (TEXT_FONTS.find((font) => font.id === fontId) ?? TEXT_FONTS[0]).stack
}

export function normalizeTextFontId(value: unknown): TextFontId | undefined {
  return TEXT_FONTS.some((font) => font.id === value) ? (value as TextFontId) : undefined
}
