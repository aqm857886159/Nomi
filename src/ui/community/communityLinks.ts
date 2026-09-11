import type { FeedbackDiagnostics } from './feedbackDiagnostics'

export const NOMI_COMMUNITY_LINKS = {
  website: 'https://nomiaqm.com/',
  github: 'https://github.com/aqm857886159/Nomi',
  issues: 'https://github.com/aqm857886159/Nomi/issues/new/choose',
} as const

/**
 * Keep the private form URL in one place. The desktop app never puts feedback
 * text, conversation content, assets, or credentials in this URL; only the
 * bounded runtime context below is carried to Tally's hidden fields.
 */
export const PRIVATE_FEEDBACK_URL = 'https://tally.so/r/GxPrx2'

function platformLabel(platform: string): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}

/**
 * Pass only low-risk runtime context to the private form. Tally's hidden
 * fields use these values to avoid making the user retype version/platform
 * details; the feedback text and attachments remain browser-confirmed inputs.
 */
export function buildPrivateFeedbackUrl(diagnostics: FeedbackDiagnostics): string {
  const params = new URLSearchParams({
    nomi_version: diagnostics.app.version,
    nomi_platform: platformLabel(diagnostics.app.platform),
    nomi_arch: diagnostics.app.arch,
    nomi_stage: diagnostics.context.stage,
    nomi_provider: [diagnostics.context.provider, diagnostics.context.model].filter(Boolean).join(' / '),
    nomi_model: diagnostics.context.model ?? '',
  })
  return `${PRIVATE_FEEDBACK_URL}?${params.toString()}`
}

/**
 * The forwardable share message = a human recommendation line + the two canonical links.
 * The i18n template ({{website}}/{{github}} placeholders) is filled here so the exact URLs
 * live in one place (NOMI_COMMUNITY_LINKS) and can never drift from the copied text.
 * This is the fix for "sharing gave a bare URL": friends get a paste-ready sentence, not a link.
 */
export function buildShareMessage(template: string): string {
  return template
    .replace(/\{\{website\}\}/g, NOMI_COMMUNITY_LINKS.website)
    .replace(/\{\{github\}\}/g, NOMI_COMMUNITY_LINKS.github)
}

/**
 * `fields`：GitHub issue form 用字段 id 当查询参数名预填正文（如 bug_report.yml 的
 * `what_happened`/`extra`，见 .github/ISSUE_TEMPLATE/bug_report.yml）。P1：这是本仓库唯一一处
 * 拼 GitHub issue 深链的地方——诊断类调用方（如 ComfyUI 未知 combo 外壳反馈）复用它，不另起一份。
 */
export function buildGitHubIssueUrl(input: { intent: 'problem' | 'suggestion'; stage: string; errorKind?: string; fields?: Record<string, string> }): string {
  const kind = input.errorKind ? ` · ${input.errorKind.slice(0, 40)}` : ''
  const title = `${input.intent === 'problem' ? '[Bug]' : '[Idea]'} ${input.stage}${kind}`
  const params = new URLSearchParams({
    template: input.intent === 'problem' ? 'bug_report.yml' : 'feature_request.yml',
    title: title.slice(0, 80),
  })
  for (const [key, value] of Object.entries(input.fields ?? {})) params.set(key, value)
  return `${NOMI_COMMUNITY_LINKS.issues}?${params.toString()}`
}
