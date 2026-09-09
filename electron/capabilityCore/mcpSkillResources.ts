// 能力核 skills.list / skills.read 返回的形状（协议层据此把技能映射成 MCP resources/prompts）。
export type SkillSummaryFrame = {
  name: string
  directoryName: string
  description: string
  packageVersion: string
  contentHash: string
  filePaths?: string[]
}
export type SkillContentFrame = SkillSummaryFrame & { body: string }

export const SKILL_URI_PREFIX = 'nomi-skill://'
export function skillResourceUri(skill: SkillSummaryFrame, filePath = 'SKILL.md'): string | null {
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(skill.directoryName)) return null
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(skill.packageVersion)) return null
  if (!/^[a-f0-9]{64}$/.test(skill.contentHash)) return null
  const suffix = filePath === 'SKILL.md' ? '' : `/${filePath.split('/').map(encodeURIComponent).join('/')}`
  return `${SKILL_URI_PREFIX}${encodeURIComponent(skill.directoryName)}/${encodeURIComponent(skill.packageVersion)}/${skill.contentHash}${suffix}`
}

export function parseSkillResourceUri(uri: string): {
  directoryName: string
  packageVersion: string
  contentHash: string
  filePath?: string
} {
  const match = /^nomi-skill:\/\/([^/]+)\/([^/]+)\/([a-f0-9]{64})(?:\/(.+))?$/.exec(uri)
  if (!match) throw new Error(`技能资源 uri 无效: ${uri}`)
  let directoryName: string
  let packageVersion: string
  try {
    directoryName = decodeURIComponent(match[1])
    packageVersion = decodeURIComponent(match[2])
  } catch {
    throw new Error(`技能资源 uri 编码无效: ${uri}`)
  }
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(directoryName) || !/^[A-Za-z0-9._-]{1,80}$/.test(packageVersion)) {
    throw new Error(`技能资源 uri 标识无效: ${uri}`)
  }
  const filePath = match[4] === undefined ? undefined : decodeURIComponent(match[4])
  if (filePath !== undefined && (!filePath || filePath.split('/').some(part => !part || part === '.' || part === '..') || filePath.includes('\\') || filePath.includes('\0'))) {
    throw new Error(`技能资源路径无效: ${uri}`)
  }
  return { directoryName, packageVersion, contentHash: match[3], ...(filePath === undefined ? {} : { filePath }) }
}

export function skillFileMimeType(filePath: string): string {
  return /\.m(?:d|arkdown)$/i.test(filePath) ? 'text/markdown' : 'text/plain'
}

