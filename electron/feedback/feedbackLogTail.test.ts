import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentLogFile, logError, logInfo, logVendorCall, logWarn } from '../logging/logger'
import { projectLogLine, projectLogLines, readRecentLogLines } from './feedbackLogTail'

const TS = '2026-10-31T01:02:03.456Z'
const line = (body: string): string => `[${TS}] ${body}`
const projected = (body: string): string => {
  const result = projectLogLine(line(body))
  if (result === null) throw new Error(`整行被丢：${body}`)
  return result.slice(`[${TS}] `.length)
}

// 都是合成靶子，断言的就是它们不许出现在产物里。
const SECRET_SK = 'sk-live-9QhT2mVx7Zb4Lp0RwEaYcN1sKdJf'
const SECRET_AWS = 'AKIAIOSFODNN7EXAMPLE'
const LONG_BASE64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eg'

/** 不许出门的东西的清单：每种一行，写法照真实日志（值已过写入时的脱敏，也有老版本没过的）。 */
const NEEDLES: { name: string; needle: string; body: string }[] = [
  { name: 'sk 形密钥', needle: SECRET_SK, body: `WARN  vendor         call reason=${SECRET_SK}` },
  { name: 'Bearer', needle: 'abcdef123456', body: 'WARN  vendor         call reason=Bearer abcdef123456' },
  { name: 'AWS key', needle: SECRET_AWS, body: `WARN  vendor         call code=${SECRET_AWS}` },
  { name: '长 base64', needle: LONG_BASE64, body: `INFO  tasks          read requestId=${LONG_BASE64}` },
  { name: 'data URI', needle: 'iVBORw0KGgo', body: 'INFO  assets         seen reason=data:image/png;base64,iVBORw0KGgoAAAANSU' },
  { name: '带 query 的 URL', needle: 'sig=abc123', body: 'WARN  vendor         get status=https://cdn.example/a.mp4?sig=abc123' },
  { name: 'file URL', needle: 'secret-movie', body: 'WARN  assets         open reason=file:///Users/me/secret-movie.mov' },
  { name: 'Mac 路径带空格和中文', needle: '猫咪短片', body: 'WARN  assets         open absolutePath=/Users/me/Nomi Projects/猫咪短片/a.png' },
  { name: 'Windows 路径', needle: 'Dreams', body: 'WARN  assets         open reason=C:\\Users\\me\\Dreams\\a.png status=1' },
  { name: 'Unix 路径', needle: 'cat-film', body: 'WARN  assets         open reason=/home/me/cat-film/a.png' },
  { name: 'firstLine 里的工具结果', needle: '末班公交车', body: 'WARN  agent          lane-tool-failed tool=write firstLine=末班公交车上只剩两个人 consecutive=2' },
  { name: 'firstLine 英文', needle: 'lonely', body: 'WARN  agent          lane-tool-failed tool=write firstLine=a lonely bus at night consecutive=2' },
  { name: '对话名', needle: 'winter-bus-lane', body: 'INFO  agent          lane-start lane=winter-bus-lane' },
  { name: '项目 id', needle: 'winter-bus', body: 'INFO  workspace      open projectId=winter-bus' },
  { name: '私有域名', needle: 'relay.corp.local', body: 'WARN  vendor         fallback host=relay.corp.local base=https://relay.corp.local' },
  { name: 'message', needle: 'overdue', body: 'WARN  update         failed message=invoice overdue for account' },
  { name: 'detail', needle: 'sandbox', body: 'WARN  agent          inactive code=X detail=sandbox is off because reasons' },
  { name: '自建中转的 vendor', needle: 'internal-proxy-corp-local', body: 'WARN  vendor         call vendor=internal-proxy-corp-local model=exec-secret-model status=500 ms=12' },
  { name: '自建中转的模型别名', needle: 'exec-secret-model', body: 'WARN  vendor         call vendor=internal-proxy-corp-local model=exec-secret-model status=500 ms=12' },
  { name: '兄弟连接名', needle: 'my-team', body: 'WARN  vendor         call vendor=apimart--my-team status=500' },
  { name: '值里有空格时第一个词', needle: 'Quarterly', body: 'WARN  downloads      failed reason=Quarterly report is missing status=1' },
  { name: '自由文本里混着像字段的词', needle: 'night', body: 'WARN  agent          failed detail=shoot it mode=night then stop' },
  { name: '自由文本里的大写词', needle: 'Project', body: 'WARN  agent          failed detail=the Project' },
]

describe('日志投影：默认不要', () => {
  for (const { name, needle, body } of NEEDLES) {
    it(`${name} 不出门`, () => {
      expect(projectLogLine(line(body))).not.toContain(needle)
    })
  }

  it('整组夹具投影后行数不为零、零命中（空产物也算过的那种假绿不算数）', () => {
    const out = projectLogLines(NEEDLES.map(({ body }) => line(body)))
    expect(out.length).toBe(NEEDLES.length)
    const joined = out.join('\n')
    for (const { needle } of NEEDLES) expect(joined).not.toContain(needle)
  })

  it('将来有人加一个新日志字段：不在表里就不出门，不用谁记得来这里拦', () => {
    expect(projected('INFO  main           boot someNewField=hello status=200')).toBe('INFO main boot … status=200')
  })

  it('认不出形状的行整行不要', () => {
    for (const bad of [
      'ts=2026-09-15T02:40:59Z event=generation-start',
      `[${TS}] 随手写的一句话 secret`,
      `[${TS}] NOTICE vendor call`,
      `[not-a-time] INFO main boot`,
      `[${TS}] INFO`,
      '',
    ]) {
      expect(projectLogLine(bad), bad).toBeNull()
    }
  })

  it('一行再长也有上限', () => {
    const body = `INFO  main           boot ${Array.from({ length: 200 }, (_item, index) => `status=${index}`).join(' ')}`
    expect((projectLogLine(line(body)) ?? '').length).toBeLessThanOrEqual(600 + `[${TS}] `.length + 1)
  })
})

describe('日志投影：该留的都留着', () => {
  it('时间、级别、模块、事件名、数字和枚举', () => {
    expect(projectLogLine(line('INFO  export         done status=ok ms=1200 bytes=42')))
      .toBe(`[${TS}] INFO export done status=ok ms=1200 bytes=42`)
  })

  it('内置家：vendor 和 model 都留（这是排查最常用的一行）', () => {
    expect(projected('WARN  vendor         call vendor=apimart model=seedance-2.5 status=503 ms=1200 attempt=2 req=abc123'))
      .toBe('WARN vendor call vendor=apimart model=seedance-2.5 status=503 ms=1200 attempt=2 req=abc123')
  })

  it('自建中转塌成 custom，模型名不留；兄弟连接只留内置 root', () => {
    expect(projected('WARN  vendor         call vendor=internal-proxy-corp-local model=exec-secret-model status=500'))
      .toBe('WARN vendor call vendor=custom model=… status=500')
    expect(projected('WARN  vendor         call vendor=apimart--my-team model=gpt-5 status=500'))
      .toBe('WARN vendor call vendor=apimart model=gpt-5 status=500')
    // 本机那几家：名字留着，模型名是用户自己起的，和目录同一个判据。
    expect(projected('WARN  vendor         call vendor=comfyui-local model=comfy-my-portrait-1 status=500'))
      .toBe('WARN vendor call vendor=comfyui-local model=… status=500')
    expect(projected('WARN  vendor         call vendor=comfyui-local--second-rig model=comfy-my-portrait-2 status=500'))
      .toBe('WARN vendor call vendor=comfyui-local model=… status=500')
  })

  it('说不上是哪家的时候老实写 unknown，不冒充 custom', () => {
    expect(projected('INFO  tasks          read vendor=? model=? status=200')).toBe('INFO tasks read vendor=unknown model=… status=200')
  })

  it('错误事实：类名、码、指纹、状态码、栈帧的文件名和行号', () => {
    expect(projected('ERROR vendor         poll-failed taskId=t-1 VendorRequestError msg#ab12cd34 code=ECONNRESET errno=-54 vendor=apimart category=network http=502 upstreamCode=model_not_found | at pollTask (poll.js:12:3) < at async run (runner.js:5:1) < at (other.js:1:2)'))
      .toBe('ERROR vendor poll-failed taskId=t-1 VendorRequestError msg#ab12cd34 code=ECONNRESET errno=-54 vendor=apimart category=network http=502 upstreamCode=model_not_found | at pollTask (poll.js:12:3) < at async run (runner.js:5:1) < at (other.js:1:2)')
  })

  it('自由文本字段后面跟着错误：文本不要，错误事实还在', () => {
    expect(projected('WARN  downloads      failed reason=disk is full TypeError msg#ab12cd34 code=ENOSPC'))
      .toBe('WARN downloads failed reason=… … TypeError msg#ab12cd34 code=ENOSPC')
  })

  it('码形 message 留着（它是我们自己的码，不是一句话）', () => {
    expect(projected('ERROR workspace      save TaskError TASK_PROJECT_MISMATCH')).toBe('ERROR workspace save TaskError TASK_PROJECT_MISMATCH')
  })

  it('表头留版本和平台', () => {
    expect(projectLogLine(line('--- session nomi=0.24.0 electron=43.0.0 win32-x64 pid=4242')))
      .toBe(`[${TS}] --- session nomi=0.24.0 electron=43.0.0 win32-x64 pid=4242`)
  })

  it('栈帧里混进来的文字不要', () => {
    expect(projected('ERROR main           boom Error | at fn (a.js:1:2) now some words')).toBe('ERROR main boom Error | at fn (a.js:1:2) …')
  })

  it('真日志写手写出来的行：投影认得它的形状（写手一改格式这条就红）', () => {
    logInfo('main', 'session-start', { version: '0.24.0', electron: '43.0.0', platform: 'darwin-arm64' })
    logVendorCall({ vendor: 'apimart', model: 'seedance-2.5', status: 503, ms: 1200, attempt: 2, requestId: 'req-123' })
    logWarn('agent', 'lane-tool-failed', { tool: 'write', firstLine: '末班公交车上只剩两个人', consecutive: 2 })
    logWarn('workspace', 'open-failed', { path: '/Users/me/Nomi Projects/猫咪短片/a.png', status: 1 })
    const failure = new Error('invoice overdue for account')
    Object.assign(failure, { code: 'ECONNRESET' })
    logError('update', 'check-failed', failure, { attempt: 3 })

    const raw = readRecentLogLines(path.dirname(currentLogFile()), 300) ?? []
    const out = projectLogLines(raw).join('\n')
    expect(out).toContain('--- session')
    expect(out).toContain('INFO main session-start version=0.24.0 electron=43.0.0 platform=darwin-arm64')
    expect(out).toContain('WARN vendor call vendor=apimart model=seedance-2.5 status=503 ms=1200 attempt=2 req=req-123')
    expect(out).toContain('WARN agent lane-tool-failed tool=write … consecutive=2')
    expect(out).toContain('WARN workspace open-failed … status=1')
    expect(out).toMatch(/ERROR update check-failed attempt=3 Error msg#[0-9a-f]{8} code=ECONNRESET \| at /)
    expect(out).not.toContain('末班公交车')
    expect(out).not.toContain('猫咪短片')
    expect(out).not.toContain('invoice')
  })
})

describe('读最近的日志文件', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-feedback-log-'))
  })
  afterEach(() => {
    fs.chmodSync(dir, 0o755)
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const write = (name: string, lines: string[]): void => fs.writeFileSync(path.join(dir, name), `${lines.join('\n')}\n`)
  const numbered = (prefix: string, count: number): string[] => Array.from({ length: count }, (_item, index) => `${prefix}-${index}`)

  it('目录里有崩溃日志时读的还是按天日志（线上 29 份全空的另一半原因：崩溃日志排在最前）', () => {
    write('nomi-crash.log', ['crash-line'])
    write('nomi-2026-10-31.log', ['daily-line'])
    expect(readRecentLogLines(dir, 300)).toEqual(['daily-line'])
  })

  it('按真实路径读，和进程的工作目录无关（线上 29 份全空的直接原因：裸文件名）', () => {
    write('nomi-2026-10-31.log', ['daily-line'])
    const cwd = process.cwd()
    expect(path.resolve(cwd)).not.toBe(path.resolve(dir))
    expect(readRecentLogLines(dir, 300)).toEqual(['daily-line'])
  })

  it('今天的文件只有几行：往前补足，顺序从旧到新', () => {
    write('nomi-2026-10-30.log', numbered('old', 5))
    write('nomi-2026-10-31.log', numbered('new', 2))
    expect(readRecentLogLines(dir, 4)).toEqual(['old-3', 'old-4', 'new-0', 'new-1'])
  })

  it('刚滚动过：滚动出来的那一代排在当前文件前面', () => {
    write('nomi-2026-10-31.1.log', numbered('archived', 3))
    write('nomi-2026-10-31.log', numbered('current', 1))
    expect(readRecentLogLines(dir, 3)).toEqual(['archived-1', 'archived-2', 'current-0'])
  })

  it('够了就不再往前读', () => {
    write('nomi-2026-10-30.log', numbered('old', 5))
    write('nomi-2026-10-31.log', numbered('new', 5))
    expect(readRecentLogLines(dir, 2)).toEqual(['new-3', 'new-4'])
  })

  it('Windows 换行也切得开', () => {
    fs.writeFileSync(path.join(dir, 'nomi-2026-10-31.log'), 'a\r\nb\r\n')
    expect(readRecentLogLines(dir, 300)).toEqual(['a', 'b'])
  })

  it('没有日志文件是空，不是读失败', () => {
    expect(readRecentLogLines(dir, 300)).toEqual([])
    expect(readRecentLogLines(path.join(dir, 'missing'), 300)).toEqual([])
  })

  it('有文件但都读不了才是读失败', () => {
    // 文件名对、读的时候是目录：不靠权限，root 下跑也成立。
    fs.mkdirSync(path.join(dir, 'nomi-2026-10-31.log'))
    expect(readRecentLogLines(dir, 300)).toBeNull()
  })

  it('一个文件读不了不连累别的', () => {
    fs.mkdirSync(path.join(dir, 'nomi-2026-10-31.log'))
    write('nomi-2026-10-30.log', ['old-line'])
    expect(readRecentLogLines(dir, 300)).toEqual(['old-line'])
  })
})
