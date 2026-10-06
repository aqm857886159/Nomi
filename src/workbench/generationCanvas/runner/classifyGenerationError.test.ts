import { describe, expect, it } from 'vitest'
import { APICallError, RetryError } from 'ai'
import { classifyGenerationError } from './generationRunController'
import { parseVendorErrorFromMessage, stripVendorErrorMarker } from './vendorErrorIpc'
import { desktopT } from '../../../../electron/i18n'
import { describeAgentError } from '../../../../electron/ai/agentError'
import { vendorStallError } from '../../../../electron/ai/aiSdkVendorError'
import { tagNomiError, stripNomiErrorCode } from '../../../../electron/shared/nomiErrorCodes'
import { describeOutboundRefusal } from '../../../../electron/networkOutboundMessage'
import { encodeStructuredErrorMessage } from '../../../../electron/vendor/vendorHttp'
import i18n from '../../../i18n'
import { narrateGenerationErrorActions, type GenerationErrorKind } from '../../observability/narrate'

describe('classifyGenerationError — 已知分类', () => {
  it('uses dedicated bilingual copy and a task-center action for production claim reasons', () => {
    const cases = [
      ['queued', 'generationCommon.observability.error.shotClaimed.queued.reason', 'view-task'],
      ['awaiting_confirmation', 'generationCommon.observability.error.shotClaimed.awaitingConfirmation.reason', 'view-task'],
      ['in_flight', 'generationCommon.observability.error.shotClaimed.inFlight.reason', 'view-task'],
      ['needs_reconcile', 'generationCommon.observability.error.shotClaimed.needsReconcile.reason', 'reconcile'],
    ] as const
    for (const [reason, key, action] of cases) {
      const report = classifyGenerationError(encodeStructuredErrorMessage({ code: 'production_shot_claimed', reason }, `production_shot_claimed: ${reason}`))
      expect(report.reason).toBe(i18n.t(key))
      expect(report.reason).not.toContain('generationCommon.')
      expect(report.primary).toBe(action)
    }
  })

  it('localizes the local missing-reference guard in English', async () => {
    await i18n.changeLanguage('en')
    try {
      const r = classifyGenerationError('图生图缺少参考图：这次请求里没有任何图片可以发给模型。')
      expect(r.reason).toBe('Image-to-image requires a reference image. Connect an image node, add a reference, or switch back to text-to-image')
      expect(r.reason).not.toMatch(/图生图|参考图/)
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })

  it('API Key 无效', () => {
    const r = classifyGenerationError('Error: 401 Unauthorized — invalid api key')
    expect(r.reason).toBe('API Key 无效')
    expect(r.hint).toMatch(/API Key/)
  })

  it('配额或限流', () => {
    const r = classifyGenerationError('429 Too Many Requests: rate limit exceeded')
    expect(r.reason).toBe('配额或限流')
  })

  it('超时归「连不上服务商」', () => {
    const r = classifyGenerationError('request failed: ETIMEDOUT')
    expect(r.reason).toBe('连不上服务商')
  })

  // 2026-08-12：network 桶原先只认 timeout 一族，「压根没连上」那半边全落 unknown，拿到
  // 「服务商临时故障或额度问题，建议稍等重试」——甩锅给没被请求到的服务商，且重试必再撞。
  // 每条都是真实来源，不是造的：undici / 浏览器 / DNS / 我们自己的代理兜底文案。
  it.each([
    ['Node/undici 主进程断网', 'TypeError: fetch failed'],
    ['浏览器 fetch 被掐断（群反馈网页版原文）', 'TypeError: Failed to fetch'],
    ['端口没人听', 'connect ECONNREFUSED 127.0.0.1:8188'],
    ['DNS 解析不到', 'getaddrinfo ENOTFOUND api.apimart.ai'],
    ['DNS 临时失败', 'getaddrinfo EAI_AGAIN api.apimart.ai'],
    ['连接被中途掐断', 'Error: socket hang up'],
    ['我们自己的代理兜底文案（中文，匹配不到 network）', '网络请求失败：无法连接到该地址。'],
  ])('连不上归「连不上服务商」并指向网络/代理，不甩锅额度：%s', (_label, message) => {
    const r = classifyGenerationError(message)
    expect(r.reason).toBe('连不上服务商')
    expect(r.hint).toMatch(/代理/)
    expect(r.hint).not.toMatch(/临时故障|额度问题/)
  })

  it('ENOTFOUND 不吞「model not found」（中间有空格，两条签名互不误伤）', () => {
    const r = classifyGenerationError('Error: model not found: seedream-9')
    expect(r.reason).toBe('模型未配置')
  })

  it('余额不足（中文）与限流区分开', () => {
    const r = classifyGenerationError('Provider request failed (code 402) at kie: 余额不足，请充值')
    expect(r.reason).toBe('余额不足')
    expect(r.hint).toMatch(/充值/)
  })

  it('余额不足（英文 balance）', () => {
    const r = classifyGenerationError('insufficient balance to perform this request')
    expect(r.reason).toBe('余额不足')
  })

  it('OpenAI insufficient_quota 仍归配额（不误判余额）', () => {
    const r = classifyGenerationError('You exceeded your current quota: insufficient_quota')
    expect(r.reason).toBe('配额或限流')
  })

  it('轮询超时归「生成超时」而非「网络超时」', () => {
    const r = classifyGenerationError('模型任务轮询超时: task-abc123')
    expect(r.reason).toBe('生成超时')
    expect(r.hint).not.toMatch(/网络/)
  })

  it('输出截断(agent length 签名)不落 unknown 的「稍等重试」误导(2026-07-15 拆镜头事故)', () => {
    const r = classifyGenerationError('模型「Mimo v2.5」这一轮达到了输出长度上限，内容被截断，没能完整返回。')
    expect(r.reason).toBe('输出超长被截断')
    expect(r.hint).toMatch(/分段|减少镜头|输出上限/)
    expect(r.hint).not.toMatch(/临时故障|稍等重试/)
  })

  it('模型未开通(火山 404,真实 structured IPC 形态):不当成「服务商临时故障」,指向控制台开通', () => {
    const upstreamMsg =
      'Your account 2126482930 has not activated the model doubao-seedream-4-5-251128. Please activate the model service in the Ark Console.'
    const message =
      "Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::" +
      Buffer.from(JSON.stringify({ category: 'unknown', httpStatus: 404, upstreamMsg, vendorKey: 'volcengine' }), 'utf8').toString('base64') +
      ":: Provider request failed (HTTP 404) at volcengine POST https://ark.cn-beijing.volces.com/api/v3/images/generations: " + upstreamMsg
    const r = classifyGenerationError(message)
    expect(r.reason).toBe('模型未开通')
    expect(r.hint).toMatch(/开通/)
    expect(r.hint).not.toMatch(/临时故障/)
    expect(r.providerMessage).toMatch(/has not activated/)
  })

  it('模型未开通(无 structured 的纯文本兜底)也能识别 reason', () => {
    const r = classifyGenerationError(
      'Provider request failed (HTTP 404) at volcengine POST https://x: 该模型未开通,请到 Ark 控制台开通管理激活',
    )
    expect(r.reason).toBe('模型未开通')
  })

  it('模型未开通即便上游标 403(被状态码派生成 auth):文本判定压过,不误导查密钥', () => {
    const raw = classifyGenerationError(
      "NOMI_VENDOR_ERR_B64::" +
        Buffer.from(JSON.stringify({ category: 'auth', upstreamMsg: '该模型未开通,请到控制台开通管理激活该模型' }), 'utf8').toString('base64') +
        ":: Provider request failed (HTTP 403) at volcengine POST https://x: 该模型未开通,请到控制台开通管理激活该模型",
    )
    expect(raw.reason).toBe('模型未开通')
    expect(raw.hint).not.toMatch(/API Key/)
  })

  it('账号档位闸·即梦非会员 → 账号权限不足(不吞进 unknown「生成失败」)', () => {
    const r = classifyGenerationError('当前即梦账号不是高级会员，无法生成。即梦免费试用已于 2026-05-01 结束——请在即梦开通会员后重试。')
    expect(r.reason).toBe('账号权限不足')
    expect(r.hint).toMatch(/会员|企业|授权/)
  })

  it('账号档位闸·RunningHub 1014 企业共享 Key → 账号权限不足(不误导成「参数不被接受」)', () => {
    const message =
      "NOMI_VENDOR_ERR_B64::" +
      Buffer.from(JSON.stringify({ category: 'input', upstreamMsg: '标准模型API仅限企业级-共享API Key调用|Access Denied: Standard Model API is restricted to Enterprise-Shared API Keys only.', vendorKey: 'runninghub' }), 'utf8').toString('base64') +
      ":: Provider request failed (code 1014) at runninghub POST https://x: 标准模型API仅限企业级-共享API Key调用"
    const r = classifyGenerationError(message)
    expect(r.reason).toBe('账号权限不足')
    expect(r.reason).not.toBe('参数不被接受')
    expect(r.providerMessage).toMatch(/企业级|Enterprise/)
  })

  it('账号档位闸·即梦首次需网页端授权 → 账号权限不足', () => {
    const r = classifyGenerationError('即梦该模型首次使用需先在网页端完成一次性内容安全授权。请打开 jimeng.jianying.com 完成授权后重试。')
    expect(r.reason).toBe('账号权限不足')
  })

  it('普通参数错不被误判成账号档位闸', () => {
    const r = classifyGenerationError('invalid param: duration out of range')
    expect(r.reason).not.toBe('账号权限不足')
  })

  it('RunningHub 605/1620 余额错误 → 余额不足(不误导成「服务商故障/参数错」)', () => {
    const mk = (code: number, msg: string, cat: string) =>
      "NOMI_VENDOR_ERR_B64::" +
      Buffer.from(JSON.stringify({ category: cat, upstreamMsg: msg, vendorKey: 'runninghub' }), 'utf8').toString('base64') +
      `:: Provider request failed (code ${code}) at runninghub POST https://x: ${msg}`
    const r605 = classifyGenerationError(mk(605, '您的账户余额不足，请充值。', 'server'))
    expect(r605.reason).toBe('余额不足')
    const r1620 = classifyGenerationError(mk(1620, '当前钱包剩余金额仅为活动会员下发金额，该类型金额不支持 API 调用，请充值。', 'input'))
    expect(r1620.reason).toBe('余额不足')
  })

  // 2026-07-31 用户真机：中转代理火山方舟 Seedance 2.0，图生视频首帧被输入审核拒收。
  // 审核拒绝走 HTTP 400 → categorizeVendorFailure 派生 input → 卡片说「参数不被接受·检查比例/
  // 尺寸」+ 红色「重试」。三处全错：不是参数问题、改比例救不了、同图同模型重试是确定性再撞。
  const ARK_IMAGE_BLOCKED_UPSTREAM =
    '{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image \'content[1]\' may contain real person. Request id: 0217854745934891b8c9f69a83502ac57f9e97e4a3cfb74b86bb8","param":"content[1]","type":"BadRequest"}}'

  it('参考图被内容安全挡下(方舟 400,真实 structured IPC 形态):不当成「参数不被接受」,也不给「重试」', () => {
    const message =
      "Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::" +
      Buffer.from(
        JSON.stringify({
          category: 'input',
          httpStatus: 400,
          upstreamMsg: ARK_IMAGE_BLOCKED_UPSTREAM,
          vendorKey: 'sd-dawnloadai-com',
        }),
        'utf8',
      ).toString('base64') +
      ':: Provider request failed (HTTP 400) at sd-dawnloadai-com POST https://sd.dawnloadai.com:8443/api/v3/contents/generations/tasks: ' +
      ARK_IMAGE_BLOCKED_UPSTREAM
    const r = classifyGenerationError(message)
    expect(r.kind).toBe('input-image-blocked')
    expect(r.reason).toBe('参考图被内容安全挡了')
    expect(r.reason).not.toBe('参数不被接受')
    expect(r.hint).not.toMatch(/比例|尺寸/)
    expect(r.hint).toMatch(/换一张参考图/)
    // 确定性失败：主按钮不能是「重试」（那是让用户对着同一个分类器死磕）。
    expect(r.primary).toBe('switch-model')
    // 「服务商原话」只给人话那一句，不把 JSON 信封（code/param/type）整坨甩用户脸上；
    // 完整报文仍在技术详情（raw）里。
    expect(r.providerMessage).toMatch(/^The request failed because the input image/)
    expect(r.providerMessage).not.toMatch(/"code"|BadRequest/)
    expect(r.raw).toMatch(/BadRequest/)
  })

  it('参考图被内容安全挡下(无 structured 的纯文本兜底)也能识别', () => {
    const r = classifyGenerationError(
      `Provider request failed (HTTP 400) at relay POST https://x: ${ARK_IMAGE_BLOCKED_UPSTREAM}`,
    )
    expect(r.kind).toBe('input-image-blocked')
  })

  it('提示词被审核拦(InputText…)仍归「提示词被拦截」,不和参考图混为一谈', () => {
    const r = classifyGenerationError(
      'Provider request failed (HTTP 400) at relay POST https://x: {"error":{"code":"InputTextSensitiveContentDetected","message":"blocked"}}',
    )
    expect(r.kind).toBe('content-policy')
    expect(r.reason).toBe('提示词被拦截')
  })

  it('普通 400 参数错不被误判成内容安全拦截', () => {
    const message =
      'NOMI_VENDOR_ERR_B64::' +
      Buffer.from(JSON.stringify({ category: 'input', httpStatus: 400, upstreamMsg: 'invalid ratio: 21:9 not supported' }), 'utf8').toString('base64') +
      ':: Provider request failed (HTTP 400) at x POST https://x: invalid ratio'
    const r = classifyGenerationError(message)
    expect(r.kind).toBe('input')
    expect(r.reason).toBe('参数不被接受')
  })

  // 2026-07-31 用户真机（同一轮）：本机图 → 免费匿名图床两个全挂 → 整条链断。
  // 旧行为落 unknown：「可能是服务商临时故障或额度问题」——甩锅给一个根本没被请求到的服务商。
  it('免配置图床全挂 → 说清「失败在我们这侧」,不甩锅服务商额度', () => {
    const r = classifyGenerationError(
      "Error invoking remote method 'nomi:tasks:run': Error: 所有免配置上传 host 都失败：litterbox.catbox.moe: 素材上传失败(HTTP 500): (无详情)；tmpfiles.org: fetch failed",
    )
    expect(r.kind).toBe('asset-upload-failed')
    expect(r.reason).toBe('参考图没能送到服务商')
    expect(r.hint).not.toMatch(/额度问题/)
    // 2026-08-01 实测：tmpfiles.org 在国内直连是 000（连不上），走代理才 405。所以
    // 「fetch failed」压倒性地是网络/代理没覆盖到这两个境外 host，而不是它们真挂了。
    // 文案必须先指向代理，否则用户对着一个网络问题去「稍后重试」，永远重试不好。
    expect(r.hint).toMatch(/代理/)
    expect(r.hint).toMatch(/境外/)
    // 哪个图床怎么挂的仍要看得见（排查线索不能丢）。
    expect(r.providerMessage).toMatch(/litterbox/)
  })

  // 2026-08-20 用户真机截图：本机 mp4 → 直连通道（非匿名链）抛裸 `素材上传失败(HTTP 413)`。
  // 旧行为落 unknown → 「可能是服务商临时故障或额度问题，建议稍等重试」，逐字如此。
  // 413 = 文件超过该 host 的 body 上限，是**确定性**失败：同一个文件重试一万次都是同一堵墙，
  // 而且每次都要把整个文件完整传上去再被拒。必须说「去压缩」，不能说「稍等重试」。
  it('素材超上传上限（413）→ 说清是文件太大，不说「稍等重试」', () => {
    const bare = classifyGenerationError(
      "Error invoking remote method 'nomi:tasks:run': Error: 素材上传失败(HTTP 413)：(无详情)",
    )
    expect(bare.kind).toBe('asset-too-large')
    expect(bare.hint).not.toMatch(/稍等重试|临时故障|额度问题/)
    expect(bare.hint).toMatch(/压缩|裁短/)
    // 换通道全挂后的汇总形态（带素材名 + 大小）同样归到这一类。
    const summarized = classifyGenerationError(
      'Error: 视频「clip.mp4（180.0MB）」超过了所有可用上传通道的大小上限，传不上去。详情：small: 素材上传失败(HTTP 413)：(无详情)',
    )
    expect(summarized.kind).toBe('asset-too-large')
    // 具体是哪个素材、多大，必须在技术详情里留得住（用户据此判断压到多少）。
    expect(summarized.raw).toMatch(/clip\.mp4/)
    expect(summarized.raw).toMatch(/180\.0MB/)
  })

  // 行为等价:root-cause 后主判据是 NOMI_ERR:: 码,不再靠中文人话子串。带码的新错误必须归到同一类,
  // 且**不依赖那句中文**——把人话整段换成英文（模拟将来 i18n 化）后,分类结果不变。
  it('素材超上限:带 NOMI_ERR 码的新错误归到 asset-too-large（与旧文案路径行为等价）', () => {
    const coded = classifyGenerationError(
      tagNomiError('asset-too-large', '视频「clip.mp4（180.0MB）」超过了所有可用上传通道的大小上限，传不上去。'),
    )
    expect(coded.kind).toBe('asset-too-large')
    expect(coded.hint).toMatch(/压缩|裁短/)
    // 码标记是给分类器读的机器信号,绝不能漏进用户可见的 raw/reason/hint。
    expect(coded.raw).not.toMatch(/NOMI_ERR/)
    expect(coded.reason).not.toMatch(/NOMI_ERR/)
    expect(coded.raw).toMatch(/clip\.mp4/)

    // 关键:人话换成英文后,分类**仍**成立（证明不再脆弱地绑在中文串上）。
    const translated = classifyGenerationError(
      tagNomiError('asset-too-large', 'The video “clip.mp4 (180.0MB)” exceeds the size limit of every available upload channel.'),
    )
    expect(translated.kind).toBe('asset-too-large')
    expect(translated.raw).not.toMatch(/NOMI_ERR/)
  })

  it('素材上传失败（非 413）:带 NOMI_ERR 码同样归到 asset-upload-failed，且英文人话不影响分类', () => {
    const coded = classifyGenerationError(tagNomiError('asset-upload-failed', '素材上传失败：所有上传通道都没成功。'))
    expect(coded.kind).toBe('asset-upload-failed')
    const translated = classifyGenerationError(tagNomiError('asset-upload-failed', 'Asset upload failed: none of the upload channels succeeded.'))
    expect(translated.kind).toBe('asset-upload-failed')
    expect(translated.raw).not.toMatch(/NOMI_ERR/)
  })

  // 2026-09-27 用户截图：参考图没过本机检查（我们自己的判断，请求没发出），错误卡却写「可能是服务商
  // 临时故障或额度问题」。按码归到 asset-invalid：不甩锅服务商、提示换素材（标题不再附「未计费」角标）。
  it('参考素材本身不合格:带 asset-invalid 码的错误不落 unknown，英文人话不影响分类', () => {
    const coded = classifyGenerationError(
      `Error invoking remote method 'nomi:tasks:run': Error: ${tagNomiError('asset-invalid', '图片素材「ref.png」的内容实际是 HTML/XML/SVG 文本，不是可用的图片素材。')}`,
    )
    expect(coded.kind).toBe('asset-invalid')
    expect(coded.reason).not.toMatch(/未计费/)
    expect(coded.hint).toMatch(/换一张|重新导入/)
    expect(coded.hint).not.toMatch(/服务商临时故障/)
    expect(coded.raw).not.toMatch(/NOMI_ERR/)
    expect(coded.raw).toMatch(/ref\.png/)
    const translated = classifyGenerationError(tagNomiError('asset-invalid', 'The reference file could not be read.'))
    expect(translated.kind).toBe('asset-invalid')
  })

  it('stripNomiErrorCode:剥掉码标记后只留人话（展示端不泄露机器信号）', () => {
    expect(stripNomiErrorCode(tagNomiError('asset-too-large', '文件太大了'))).toBe('文件太大了')
    expect(stripNomiErrorCode('没有标记的普通错误')).toBe('没有标记的普通错误')
  })

  // 直连通道（KIE/apimart）抛的裸上传失败，不带匿名链那句包装 → 此前也会落 unknown 甩锅服务商。
  it('直连通道的上传失败（非 413）也归到「没送到服务商」，不落 unknown', () => {
    const r = classifyGenerationError(
      "Error invoking remote method 'nomi:tasks:run': Error: 素材上传失败(HTTP 401)：invalid key",
    )
    expect(r.kind).toBe('asset-upload-failed')
    expect(r.kind).not.toBe('unknown')
  })

  it('未识别错误的首行不再顶着 Electron IPC 包装前缀（对用户零信息）', () => {
    const r = classifyGenerationError(
      "Error invoking remote method 'nomi:tasks:run': Error: 上游返回了一个我们没见过的形状",
    )
    expect(r.reason).toBe('上游返回了一个我们没见过的形状')
    expect(r.reason).not.toMatch(/invoking remote method/)
    // raw 保留原样：技术详情折叠区还得能看到完整链路。
    expect(r.raw).toMatch(/invoking remote method/)
  })

  it('剪贴板网页媒体下载失败时优先提示下载到本地', () => {
    const r = classifyGenerationError('网页媒体下载失败：该站点可能禁止跨域请求或开启防盗链。请先下载到本地，再复制或拖入画布。')
    expect(r.reason).toBe('网页媒体下载失败')
    expect(r.hint).toMatch(/下载到本地/)
    expect(r.hint).toMatch(/防盗链/)
  })
})

describe('classifyGenerationError — 未识别兜底（方案 B 改进）', () => {
  it('从 JSON error.message 抠可读首行当 reason，并给兜底 hint', () => {
    const raw = JSON.stringify({ error: { message: 'model is overloaded, try again' } })
    const r = classifyGenerationError(raw)
    expect(r.reason).toBe('model is overloaded, try again')
    expect(r.hint).not.toBe('')
    expect(r.raw).toBe(raw)
  })

  it('从顶层 message 抠', () => {
    const r = classifyGenerationError(JSON.stringify({ message: 'something odd happened' }))
    expect(r.reason).toBe('something odd happened')
  })

  it('纯文本取第一行非空并截断', () => {
    const r = classifyGenerationError('\n  weird provider failure line one  \nstack frame 2\nstack frame 3')
    expect(r.reason).toBe('weird provider failure line one')
  })

  it('超长首行截断到 100 字带省略号', () => {
    const long = 'x'.repeat(300)
    const r = classifyGenerationError(long)
    expect(r.reason.length).toBeLessThanOrEqual(100)
    expect(r.reason.endsWith('…')).toBe(true)
  })

  it('空 raw 退回「生成失败」但仍带兜底 hint', () => {
    const r = classifyGenerationError('')
    expect(r.reason).toBe('生成失败')
    expect(r.hint).not.toBe('')
  })
})

describe('structured 路径(S4-2:VendorRequestError 经 IPC 标记穿透)', () => {
  const encode = (structured: Record<string, unknown>, tail = 'Provider request failed (code 402) at kie POST https://x: 余额不足') =>
    `Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`

  it('uses the stable timeout category without depending on English timeout keywords', () => {
    const result = classifyGenerationError(encode(
      { category: 'timeout', reasonCode: 'response_timeout', upstreamMsg: '读取响应超时（120s）' },
      'Provider request failed: 读取响应超时（120s）',
    ))
    expect(result.reason).toBe('连不上服务商')
  })

  it('balance 类别直读 structured,不靠正则;raw 剥掉标记段', () => {
    const r = classifyGenerationError(encode({ category: 'balance', upstreamMsg: '余额不足', vendorKey: 'kie' }))
    expect(r.reason).toBe('余额不足')
    expect(r.raw).not.toContain('NOMI_VENDOR_ERR_B64')
    expect(r.raw).toContain('余额不足')
  })

  it('中文 upstreamMsg 的 base64 roundtrip 不乱码', () => {
    // tail 不能用默认（默认含「余额不足」会触发 balance 文案判定）——本例测 quota，给 quota 语义的 tail。
    const r = classifyGenerationError(encode({ category: 'quota', upstreamMsg: '触发限流·稍后再试' }, 'Provider request failed (code 429) at kie POST https://x: rate limited'))
    expect(r.reason).toBe('配额或限流')
  })

  it('未知类别退回 legacy 正则路径', () => {
    const r = classifyGenerationError(encode({ category: 'weird-new-thing' }, 'something 401 unauthorized'))
    expect(r.reason).toBe('API Key 无效')
  })
})

describe('providerMessage —— 服务商真实原话提到可见区（别埋进折叠的技术详情）', () => {
  const encode = (structured: Record<string, unknown>, tail = 'Provider request failed (code 429) at dm-fox: x') =>
    `Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`

  it('structured: 分类标题通用，但服务商原话单独可见', () => {
    const r = classifyGenerationError(encode({ category: 'quota', upstreamMsg: '官方算力限制，请等待一段时间后再进行使用' }))
    expect(r.reason).toBe('配额或限流') // 标题仍是"哪一类"
    expect(r.providerMessage).toBe('官方算力限制，请等待一段时间后再进行使用') // 真实原因可见
  })

  it('structured: 原话与分类标题重复时不冗余显示', () => {
    const r = classifyGenerationError(encode({ category: 'balance', upstreamMsg: '余额不足' }))
    expect(r.reason).toBe('余额不足')
    expect(r.providerMessage).toBeUndefined()
  })

  it('structured: 占位「(no detail from provider)」不显示', () => {
    const r = classifyGenerationError(encode({ category: 'server', upstreamMsg: '(no detail from provider)' }))
    expect(r.providerMessage).toBeUndefined()
  })

  it('legacy: 从 raw 抠出的可读原话也提到可见区', () => {
    const r = classifyGenerationError('429 rate limit: 当前模型排队人数过多，请稍后再试')
    expect(r.reason).toBe('配额或限流')
    expect(r.providerMessage).toMatch(/排队人数过多/)
  })

  it('unknown 兜底: reason 本身就是原话，不重复给 providerMessage', () => {
    const r = classifyGenerationError(JSON.stringify({ message: 'something odd happened' }))
    expect(r.reason).toBe('something odd happened')
    expect(r.providerMessage).toBeUndefined()
  })
})

describe('即梦 CLI 错误不被误吞成「模型未开通/火山 Ark 指引」（2026-07-06 真机走查抓出）', () => {
  it('即梦静默兜底文案（含「开通即梦会员」「该模型首次使用」）→ 账号权限不足，非模型未开通', () => {
    const msg = '即梦生成被拒，但 CLI 未返回任何原因（exit=1）。常见原因：① 当前即梦账号不是高级会员（免费试用 2026-05-01 已结束，需开通即梦会员）；② model_version / resolution 等参数组合不被当前模型支持；③ 该模型首次使用需先在 jimeng.jianying.com 网页端授权一次；④ 即梦服务端临时异常。'
    const report = classifyGenerationError(msg)
    expect(report.reason).toBe('账号权限不足')
    expect(report.reason).not.toBe('模型未开通')
  })
  it('火山方舟真·未开通文案仍归「模型未开通」（不被调序误伤）', () => {
    const report = classifyGenerationError('The account has not activated the model service: doubao-seedream')
    expect(report.reason).toBe('模型未开通')
  })
  it('即梦登录态失效文案 → 账号权限不足桶（原话可见）', () => {
    const report = classifyGenerationError('即梦登录态失效或未登录：请到「模型接入 · 即梦会员」卡重新登录（或终端运行 dreamina login），完成后重试。')
    expect(report.reason).not.toBe('模型未开通')
  })
})

describe('上游「模型不存在」不再退化成一句 taskId（2026-07-30 用户真机 Imagen 4 报错）', () => {
  // 用户看到的整条：「模型任务执行失败 (taskId=task_01KYQJG…, kind=text_to_image)」——上游真原因
  // （Google 404 Requested entity was not found）被 profile 声明却无人读的 error_message 吞了。
  // 修复后 describeTaskFailure 拿到的是真原话；这里锁的是拿到之后的分类不能再误导。
  const REAL_UPSTREAM = 'Requested entity was not found. (taskId=task_01KYRKKK35KCAASMFC7ND2PR6P, kind=text_to_image)'

  it('主动作 = 换个模型（不是重试）——重试必再撞同一堵墙', () => {
    const report = classifyGenerationError(REAL_UPSTREAM)
    expect(report.reason).toBe('这个模型服务商这边取不到')
    expect(report.primary).toBe('switch-model')
    // 重试降为次动作：不堵死用户，但也不许在建议文案里假装它有用。
    expect(report.secondary).toBe('retry')
    expect(report.hint).not.toMatch(/稍等|稍后再试/)
  })

  it('不误判成「模型未配置」（本地没配）或「模型未开通」（去控制台开）——动作完全不同', () => {
    const report = classifyGenerationError(REAL_UPSTREAM)
    expect(report.reason).not.toBe('模型未配置')
    expect(report.reason).not.toBe('模型未开通')
  })

  it('短语取窄：素材/项目一类的 404 不被误吞', () => {
    expect(classifyGenerationError('下载素材失败：404 Not Found').reason).not.toBe('这个模型服务商这边取不到')
    expect(classifyGenerationError('项目不存在或已被删除').reason).not.toBe('这个模型服务商这边取不到')
  })
})

describe('每类错误都说得出「该干嘛」（2026-07-30 拍板：主按钮按错误类型走）', () => {
  it('确定性失败不给重试当主按钮——那是骗用户', () => {
    // 上游没这个模型 / 已下线 → 换模型；密钥·开通·分组·档位 → 去模型接入。
    expect(classifyGenerationError('Model is retired: imagen-4.0-apimart').primary).toBe('switch-model')
    expect(classifyGenerationError('401 unauthorized: bad api key').primary).toBe('open-model-access')
    expect(classifyGenerationError('The account has not activated the model service: x').primary).toBe(
      'open-model-access',
    )
    expect(classifyGenerationError('Image generation is not enabled for this group').primary).toBe('open-model-access')
    expect(classifyGenerationError('账户余额不足，请充值').primary).toBe('open-model-access')
  })

  it('偶发失败仍给重试当主按钮（不是一刀切换模型）', () => {
    expect(classifyGenerationError('ETIMEDOUT while connecting').primary).toBe('retry')
    expect(classifyGenerationError('429 rate limit').primary).toBe('retry')
    expect(classifyGenerationError('某种没见过的报错').primary).toBe('retry')
  })

  it('次动作恒为「另一个可能有用的」，且不与主动作重复', () => {
    for (const message of ['Model is retired: x', '401 unauthorized', 'ETIMEDOUT', '没见过的错']) {
      const report = classifyGenerationError(message)
      expect(report.secondary).not.toBe(report.primary)
    }
    // 主 = 重试 → 次给换模型（等不及就换一家）。
    expect(classifyGenerationError('ETIMEDOUT').secondary).toBe('switch-model')
  })
})

describe('动作表：每类主 / 次动作都写在表里，改一类不许带动别的类', () => {
  // 穷举：漏写一类 → check:test-types 红（Record 要求每个 kind 都在）。
  const EVERY_KIND: Record<GenerationErrorKind, true> = {
    auth: true, balance: true, quota: true, 'poll-timeout': true, network: true, 'model-config': true,
    'model-kind-mismatch': true, 'model-not-open': true, 'model-unavailable-upstream': true, 'model-retired': true,
    'image-route-disabled': true, 'account-gate': true, 'content-policy': true, 'input-image-blocked': true,
    'asset-upload-failed': true, 'asset-too-large': true, 'asset-invalid': true, 'outbound-blocked': true,
    'outbound-blocked-submit': true, 'outbound-blocked-credential-origin': true, 'credential-redirect': true, server: true, input: true,
    'output-truncated': true, 'output-unreadable': true, 'submission-unknown': true, 'submission-not-sent': true, 'output-retrieval-failed': true, unknown: true,
  }

  it('已下线、读不出来以外的每一类，次动作都和改表前的规则一样（主动作是重试 / 一键改对 → 换个模型；其余 → 重试）', () => {
    for (const kind of Object.keys(EVERY_KIND) as GenerationErrorKind[]) {
      const { primary, secondary } = narrateGenerationErrorActions(kind)
      const before = primary === 'retry' || primary === 'fix-model-kind' ? 'switch-model' : 'retry'
      // 已下线、读不出来：这两类不给第二个动作（重试必再撞同一张卡 / 换供应商不是解法）；
      // 结果未知：不给重试（可能重复提交），只指路去核对。
      // 已生成、取回失败：只指路去任务面板「重新取回」，不给第二个动作（重试 = 再生成一份）。
      expect({ kind, secondary }).toEqual({ kind, secondary: kind === 'model-retired' || kind === 'output-unreadable' || kind === 'output-retrieval-failed' ? null : kind === 'submission-unknown' ? 'release-regenerate' : before })
    }
  })
})

describe('已生成、取回失败（#975 A2）', () => {
  const raw = tagNomiError('output-retrieval-failed', 'The provider finished this shot, but Nomi could not retrieve the result: Fetch failed: HTTP 403')

  it('按稳定码认，不印「服务商原话」，只指路去任务面板，绝不给重试', () => {
    const report = classifyGenerationError(raw)
    expect(report.kind).toBe('output-retrieval-failed')
    expect(report.primary).toBe('view-task')
    expect(report.secondary).toBeNull()
    expect(report.hint).toContain('重新取回')
    expect(report.hint).toContain('不要重新生成')
  })
})

describe('付费提交结果未知（连接在请求发出后被重置）', () => {
  const raw = tagNomiError('submission-unknown', 'apimart image submission failed: TypeError: fetch failed ← SocketError UND_ERR_SOCKET: other side closed')

  it('不被归成「连不上服务商 / 请求没发到」，也不给重试', () => {
    const report = classifyGenerationError(raw)
    expect(report.kind).toBe('submission-unknown')
    expect(report.reason).not.toContain('连不上')
    expect(report.hint).not.toContain('没发到')
    expect(report.primary).toBe('reconcile')
    // 没有一键重试；次动作是「我核对过了，重新生成」（点下去先展开确认，不直接生成）。
    expect(report.secondary).toBe('release-regenerate')
    expect(report.hint).toContain('先到服务商后台')
  })

  it('同样的原始网络报错不带标记时仍按网络类处理（标记才是「未知」的唯一出处）', () => {
    expect(classifyGenerationError('fetch failed UND_ERR_SOCKET').kind).toBe('network')
  })
})

describe('模型已下线 ≠ 模型被停用（删模型不能变成坑换坑）', () => {
  it('退役签名 → 中文人话 + 换个模型，不是英文技术原话', () => {
    const report = classifyGenerationError('Model is retired: imagen-4.0-apimart')
    expect(report.reason).toBe('这个模型已经下线了')
    expect(report.primary).toBe('switch-model')
    expect(report.hint).not.toMatch(/稍等|稍后再试/)
    // 这是我们自己的签名，服务商没被请求到：不许以「服务商原话：Model is retired: …」印进卡片正文。
    expect(report.providerMessage).toBeUndefined()
    // 技术详情里的原文照留（复制详情 / 反馈要用），只是不进可见正文。
    expect(report.raw).toContain('Model is retired: imagen-4.0-apimart')
  })

  // 2026-09-29 协调会话裁决（撤 Sora 2 以后这张卡会被更多人看到）：
  // 「仍要重试」对已下线必然再撞同一张卡，不摆；文案对任何下线原因都成立，不再说「在服务商那边一直失败」。
  it('已下线：没有次动作，文案不替下线编原因（中英都查）', async () => {
    const report = classifyGenerationError('Model is retired: sora-2')
    expect(report.secondary).toBeNull()
    for (const language of ['zh-CN', 'en']) {
      await i18n.changeLanguage(language)
      const localized = classifyGenerationError('Model is retired: sora-2')
      expect(localized.hint).not.toMatch(/一直失败|服务商|kept failing|provider/i)
      expect(localized.hint).toMatch(/换个模型|Switch to another model/)
    }
    await i18n.changeLanguage('zh-CN')
  })

  it('「被停用」仍归模型未配置 → 去模型接入（记录还在，那儿能开回来）', () => {
    const report = classifyGenerationError('Model is not enabled: some-model')
    expect(report.reason).not.toBe('这个模型已经下线了')
    expect(report.primary).toBe('open-model-access')
  })
})

// 眼见链末端：未登记状态动词的根因修复（electron/tasks/taskResultQuery）把上游原始动词写进
// TaskResult.error，而错误卡显示的是 classifyGenerationError(...).reason（NodeErrorReport 里的
// 加粗大标题）。若哪天有分类器把这条消息吃掉、替换成自己的人话文案，用户就又看不到 "failure"
// 这个原始动词了——那正是这次修复要送到用户眼前的东西。这里把它钉死。
// 文案真相源：electron/i18n.ts 的 tasks.unrecognizedStatus / tasks.pollTimedOut。
describe('未登记状态动词：原始动词必须原样送到错误卡标题', () => {
  const UNRECOGNIZED =
    '上游返回了无法识别的任务状态：「failure」。连续查询 4 次、持续 160 秒都是这个状态，Nomi 按失败处理。该任务也可能仍在供应商侧运行——请到供应商后台核对。'

  it('分类不吞掉消息，reason 原样带着上游动词', () => {
    const report = classifyGenerationError(UNRECOGNIZED)
    expect(report.reason).toContain('failure')
    expect(report.reason).toBe(UNRECOGNIZED)
  })

  it('不被别的分类器误抢（消息里的数字不该被当成余额/限流码）', () => {
    const report = classifyGenerationError(UNRECOGNIZED)
    expect(report.reason).not.toBe('余额不足')
    expect(report.reason).not.toBe('配额或限流')
    expect(report.reason).not.toBe('这个模型已经下线了')
  })

  it('轮询超时文案同样不被吞（含「超时」二字，别被网络超时抢走原文）', () => {
    const report = classifyGenerationError(
      '等待生成结果超时（已等 240 秒，最后状态：queued）。任务可能仍在供应商侧运行——请到供应商后台核对，或稍后重新拉取结果。',
    )
    expect(report.reason).toContain('仍在供应商侧运行')
  })
})

// 眼见链末端 ②：「没有 query op」的根因修复（同上一条的姊妹路径）。这里**直接读 electron/i18n
// 的真串**而不是抄一份——抄的那份会跟着源漂移，测试就变成自说自话。
// 钉的是两件事，都是实测踩到过的：
//  ① 长度：错误卡大标题走 truncateLine，**超 100 字截尾**，而被截掉的恰是「该怎么办」那半句。
//     初版文案 110 字，用户看到的结尾是「…确认这次调用是否真的出…」——行动指引整段丢失。
//  ② 不被别的分类器抢走（文案里有「配置」「失败处理」这类高频关键词）。
describe('无 query op：诚实失败文案要完整送到错误卡标题', () => {
  const NO_QUERY = desktopT('tasks.noQueryOperation')

  it('短到不会被标题截断（含上游原话时也要留得下）', () => {
    const report = classifyGenerationError(NO_QUERY)
    expect(report.reason).toBe(NO_QUERY)
    expect(report.reason).not.toContain('…')
    // 留出上游原话的余量：中转的「no available channel」一类要能跟着一起显示。
    const withDetail = NO_QUERY + desktopT('tasks.upstreamSaid', { detail: 'no available channel' })
    expect(classifyGenerationError(withDetail).reason).toContain('no available channel')
  })

  it('「该怎么办」那半句必须活着到用户眼前（被截掉就等于没说）', () => {
    expect(classifyGenerationError(NO_QUERY).reason).toContain('接入配置')
  })

  it('不被别的分类器误抢（「配置」「失败」都是高频词）', () => {
    const report = classifyGenerationError(NO_QUERY)
    expect(report.reason).not.toBe('模型未配置')
    expect(report.reason).not.toBe('生成失败')
    expect(report.reason).not.toBe('余额不足')
  })

  it('上游原话里有真因时让真因赢——余额不足要给「去充值」而不是我们的通用文案', () => {
    const report = classifyGenerationError(NO_QUERY + desktopT('tasks.upstreamSaid', { detail: 'insufficient balance' }))
    expect(report.reason).toBe('余额不足')
    expect(report.primary).toBe('open-model-access')
  })
})

// ---------------------------------------------------------------------------
// 文本侧（AI SDK）真实错误形态 —— 与图/视频侧同一条结构化契约
// ---------------------------------------------------------------------------
// 病根（2026-08-12）：图/视频侧的失败在抛出那一刻就带 category（vendorHttp 查表），穿 IPC 到这里
// 被优先采信；文本侧走 AI SDK，失败被压成一句裸字符串，这里只能用 detectLegacyErrorKind 的关键词
// 正则去猜。猜就按类漏——上面那串注释里已记着 5 次同型补丁，每次都是「撞到一种没被枚举的措辞 →
// 落 unknown → 拿到『可能是服务商临时故障或额度问题，建议稍等重试』」。
//
// 这组测试**不手搓字符串**：直接喂 electron 侧 describeAgentError() 的真实产物，钉住整条契约
// （AI SDK 错误 → VendorRequestError → base64 标记 → 这里的 structured 分支）任一环断了都红。
describe('文本侧 AI SDK 错误：走 structured 分支，不靠关键词猜', () => {
  const VENDOR = { vendorKey: 'apimart' }

  const apiError = (opts: { statusCode?: number; responseBody?: string; message?: string }): APICallError =>
    new APICallError({
      message: opts.message ?? 'Bad Request',
      url: 'https://api.apimart.ai/v1/chat/completions',
      requestBodyValues: {},
      ...(opts.statusCode != null ? { statusCode: opts.statusCode } : {}),
      ...(opts.responseBody != null ? { responseBody: opts.responseBody } : {}),
    })

  /** maxRetries 打光后 SDK 抛的套壳形态——429/5xx/网络失败在真机上就长这样。 */
  const retryWrapped = (last: APICallError): RetryError =>
    new RetryError({
      message: `Failed after 4 attempts. Last error: ${last.message}`,
      reason: 'maxRetriesExceeded',
      errors: [last, last, last, last],
    })

  it.each([
    ['401 鉴权', 401, 'auth'],
    ['402 欠费', 402, 'balance'],
    ['429 限流', 429, 'quota'],
    ['400 参数', 400, 'input'],
    ['500 服务商故障', 500, 'server'],
  ] as const)('%s → kind=%s，且 category 来自源头而不是正则', (_label, statusCode, kind) => {
    const message = describeAgentError(apiError({ statusCode }), VENDOR)
    // ① 结构化载荷确实穿过来了（这一条断了就说明 electron 侧没编码）
    expect(parseVendorErrorFromMessage(message)?.category).toBe(kind)
    // ② 分类结果就是它（这一条断了就说明 classifyError 没采信 structured）
    expect(classifyGenerationError(message).kind).toBe(kind)
  })

  // 决定性证据：把标记剥掉再分类 = 模拟「没有结构化时」的老路。答案不同 ⇒ 上面走的确实是
  // structured 分支，不是碰巧被关键词猜中。500/400 是关键词表**永远猜不到**的两类
  // （报文里没有 'quota'/'balance'/'timeout' 这些词，只有一个状态码）。
  it('500 关键词表猜不到——剥掉结构化就退回 unknown 的「稍等重试」误导', () => {
    const message = describeAgentError(retryWrapped(apiError({ statusCode: 500, message: 'Internal Server Error' })), VENDOR)
    expect(classifyGenerationError(message).kind).toBe('server')
    // 老路（无结构化）在同一条报错上给的是 unknown
    expect(classifyGenerationError(stripVendorErrorMarker(message)).kind).toBe('unknown')
  })

  it('400 同理——参数被拒不该落进「可能是额度问题」', () => {
    const message = describeAgentError(apiError({ statusCode: 400, message: 'Bad Request' }), VENDOR)
    expect(classifyGenerationError(message).kind).toBe('input')
    expect(classifyGenerationError(stripVendorErrorMarker(message)).kind).toBe('unknown')
  })

  it('连不上服务商（断网/代理不通）：不甩锅给没被请求到的服务商', () => {
    // provider-utils 在 `TypeError: fetch failed` 且带 cause 时造的正是这个形状（无 statusCode），
    // 可重试 → 打光 3 次重试后套 RetryError 抛出。用户拆镜头时断网撞的就是这条。
    const message = describeAgentError(
      retryWrapped(
        new APICallError({
          message: 'Cannot connect to API: connect ECONNREFUSED 127.0.0.1:443',
          url: 'https://api.apimart.ai/v1/chat/completions',
          requestBodyValues: {},
          isRetryable: true,
        }),
      ),
      VENDOR,
    )
    const report = classifyGenerationError(message)
    expect(parseVendorErrorFromMessage(message)?.category).toBe('network')
    expect(report.kind).toBe('network')
    expect(report.reason).toBe('连不上服务商')
    // 这句才是当初的病：把用户自己的网络问题说成服务商的额度/故障，还劝他重试（必再撞）。
    expect(report.hint).not.toMatch(/临时故障|额度问题/)
  })

  it('上游人话（中转只把真原因放在 responseBody）跟着一起到错误卡', () => {
    const message = describeAgentError(
      apiError({ statusCode: 400, responseBody: JSON.stringify({ error: { message: '官方算力限制，请等待一段时间后再进行使用' } }) }),
      VENDOR,
    )
    expect(classifyGenerationError(message).providerMessage).toContain('官方算力限制')
  })

  it('文案信号仍压过状态码——火山「模型未开通」走 404，别被派生成 unknown', () => {
    // detectModelNotOpen 一族在 structured 分支之前判，接上文本侧后这条链才真正通：
    // 以前文本侧根本没有 upstreamMsg 可给它读。
    const message = describeAgentError(
      apiError({
        statusCode: 404,
        responseBody: JSON.stringify({
          error: { message: 'Your account has not activated the model doubao-seedance. Please activate the model service in the Ark Console.' },
        }),
      }),
      VENDOR,
    )
    expect(classifyGenerationError(message).kind).toBe('model-not-open')
  })

  it('流式超时（我们自己按下的 abort）归 network，而不是一句正则匹配不上的中文裸串', () => {
    const message = describeAgentError(vendorStallError('模型 90s 内无响应（端点慢或挂起）', VENDOR), VENDOR)
    expect(classifyGenerationError(message).kind).toBe('network')
  })

  it('不是厂商请求失败的照旧走 legacy——空响应截断仍是 output-truncated，没被结构化抢走', () => {
    const message = describeAgentError(new Error('模型「Mimo v2.5」这一轮达到了输出长度上限，内容被截断，没能完整返回。'))
    expect(parseVendorErrorFromMessage(message)).toBeNull()
    expect(classifyGenerationError(message).kind).toBe('output-truncated')
  })
})

describe('出站被我们自己的安全策略拦下（2026-09-06 真实验收：钱扣了、成片取不回、界面只说「生成失败」）', () => {
  const refusal = () =>
    describeOutboundRefusal({
      reason: 'private-address',
      hostname: 'api.apimart.ai',
      observedAddress: '198.18.0.140',
      syntheticResolver: false,
      stage: 'retrieval',
    })

  it('归成 outbound-blocked，不再掉进 unknown 的「稍等重试」', () => {
    const report = classifyGenerationError(refusal())
    expect(report.kind).toBe('outbound-blocked')
    expect(report.reason).not.toBe(i18n.t('generationCommon.observability.error.unknown.reason'))
  })

  it('主动作不是 retry —— 重试 = 再生成 = 再扣一次钱，而这次的钱根本没丢', () => {
    const report = classifyGenerationError(refusal())
    expect(report.primary).toBe('open-model-access')
    expect(report.primary).not.toBe('retry')
    // 文案必须明说别重新生成，否则用户仍会去点那颗要花钱的按钮。
    expect(report.hint).toContain('不要重新生成')
  })

  it('给用户看的文案里没有机器码标记，但说得出 fake-ip 与「免费重新拉取」', () => {
    const report = classifyGenerationError(refusal())
    expect(report.reason).not.toContain('NOMI_ERR::')
    expect(report.raw).not.toContain('NOMI_ERR::')
    // 人话里必须同时出现「已付费没丢」与「重新拉取」，否则用户仍会去点那颗要花钱的重试。
    expect(`${report.reason}${report.hint}`).toContain('重新取回')
  })

  it('不把这条栽赃给服务商：它根本没被请求到，「服务商说：」框必须是空的', () => {
    expect(classifyGenerationError(refusal()).providerMessage).toBeFalsy()
  })

  it('按稳定码分类，不按那句中文 —— 人话换成英文也照样归对', () => {
    const englishShaped = tagNomiError('outbound-blocked', 'Download blocked by network policy.')
    expect(classifyGenerationError(englishShaped).kind).toBe('outbound-blocked')
  })
})

// ---------------------------------------------------------------------------
// 失败原因按**上游自己的码与话**归类，不按状态码猜（2026-09-29 全功能走查 pb06）：
// 供应商回 HTTP 400「这个模型已下线，请换一个」，界面却说「参数不被接受，请检查比例 / 尺寸」——
// 因为 400 被状态码表一律派生成 input。400 只说「请求有问题」，从不说为什么。
// ---------------------------------------------------------------------------
describe('失败原因按上游自己的码与话归类（一张目录，没有某某家的分支）', () => {
  const encode = (structured: Record<string, unknown>, tail = 'Provider request failed (HTTP 400) at agent-runtime-loopback POST http://127.0.0.1:59109/v1/images/generations: x') =>
    `Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`
  const DEPRECATED = 'This model has been deprecated and is no longer available. Please switch to another model or provider.'
  /** 全功能走查 pb06 里供应商夹具回的那一笔，逐字段照抄（载荷来自 evidence 目录的 c2-node-generate.json）。 */
  const walkPayload = {
    vendorKey: 'agent-runtime-loopback', method: 'POST', url: 'http://127.0.0.1:59109/v1/images/generations',
    httpStatus: 400, upstreamMsg: DEPRECATED, category: 'input', retryable: false,
  }

  it('走查那一笔（模型已下线的 400）：说的是「这个模型用不了」，动作是换个模型，不是去改比例', () => {
    const report = classifyGenerationError(encode({ ...walkPayload, upstreamCode: 'model_not_found' }))
    expect(report.kind).toBe('model-unavailable-upstream')
    expect(report.reason).not.toBe(i18n.t('generationCommon.observability.error.input.reason'))
    expect(report.primary).toBe('switch-model')
    expect(`${report.reason}${report.hint}`).not.toMatch(/比例|尺寸|参数/)
    // 供应商自己的话仍然可见（次要信息），只是不再顶替标题。
    expect(report.providerMessage).toBe(DEPRECATED)
  })

  it('没有码也认：供应商的话（已下线 / 不再可用）本身就是证据，旧载荷 / 别的供应商同样归对', () => {
    expect(classifyGenerationError(encode(walkPayload)).kind).toBe('model-unavailable-upstream')
  })

  it('只有码也认：上游只回了 model_not_found 和一句没有信息量的话', () => {
    expect(classifyGenerationError(encode({ ...walkPayload, upstreamMsg: 'no available channel', upstreamCode: 'model_not_found' })).kind)
      .toBe('model-unavailable-upstream')
  })

  it.each([
    ['该模型已下线，请更换模型', undefined],
    ['The model `gpt-image-9` does not exist or you do not have access to it.', undefined],
    ['No such model: seedream-9', undefined],
    ['unavailable', 'model_unavailable'],
  ])('同一类的其他说法：%s', (upstreamMsg, upstreamCode) => {
    expect(classifyGenerationError(encode({ ...walkPayload, upstreamMsg, ...(upstreamCode ? { upstreamCode } : {}) })).kind)
      .toBe('model-unavailable-upstream')
  })

  it('异步任务失败那条路（只有格式、没有载荷）同样认：话在 (taskId=…, kind=…) 之前', () => {
    const report = classifyGenerationError(`${DEPRECATED} (taskId=task_01ABC, kind=text_to_image)`)
    expect(report.kind).toBe('model-unavailable-upstream')
    expect(report.providerMessage).toBe(DEPRECATED)
    expect(report.providerMessage).not.toContain('taskId')
  })

  // 类的另一头：真参数错**仍然**是「参数不被接受」——本次修的是「没有证据就把 400 说成参数错」，不是取消这个类别。
  it.each([
    ['size 不在支持列表', "Invalid value for 'size': '3000x3000'. Supported values are: 1024x1024, 1792x1024, 1024x1792.", 'invalid_value'],
    ['比例不支持', 'aspect_ratio must be one of 1:1, 16:9, 9:16', undefined],
    ['参数已弃用（不是模型已弃用）', "The 'quality' parameter is deprecated; use 'resolution' instead.", undefined],
    ['这个模型不支持某个参数（不是模型不可用）', "Parameter 'seed' is not supported for this model", undefined],
    ['模型不支持这个比例', 'Model seedream-5 does not support aspect ratio 21:9', undefined],
    ['没有任何说明的 400', 'Bad Request', undefined],
  ])('真参数错仍归「参数不被接受」：%s', (_label, upstreamMsg, upstreamCode) => {
    const report = classifyGenerationError(encode({ ...walkPayload, upstreamMsg, ...(upstreamCode ? { upstreamCode } : {}) }))
    expect(report.kind).toBe('input')
    expect(report.reason).toBe(i18n.t('generationCommon.observability.error.input.reason'))
  })

  it('URL 路径里的 /model/ 不是证据：证据只读供应商说的那句话', () => {
    const report = classifyGenerationError(encode(
      { ...walkPayload, httpStatus: 404, category: 'unknown', upstreamMsg: 'Route not found', url: 'https://relay.example/v1/model/abc' },
      'Provider request failed (HTTP 404) at relay GET https://relay.example/v1/model/abc: Route not found',
    ))
    expect(report.kind).not.toBe('model-unavailable-upstream')
    // 没有码也没有认得的话：也不许把没证据的 404 说成「参数不被接受」
    expect(report.kind).not.toBe('input')
  })

  it('图 / 视频侧与文本侧两条通道带过来的码同形：文本侧（AI SDK）同样按码归类', () => {
    const apiError = new APICallError({
      message: 'Bad Request', url: 'https://api.apimart.ai/v1/chat/completions', requestBodyValues: {}, statusCode: 400,
      responseBody: JSON.stringify({ error: { code: 'model_not_found', message: 'The model gpt-x does not exist' } }),
    })
    const message = describeAgentError(apiError, { vendorKey: 'apimart' })
    expect(parseVendorErrorFromMessage(message)?.upstreamCode).toBe('model_not_found')
    expect(classifyGenerationError(message).kind).toBe('model-unavailable-upstream')
  })

  it.each(['zh-CN', 'en'])('下线文案说得对、不带走参数：%s', async (language) => {
    await i18n.changeLanguage(language)
    try {
      const report = classifyGenerationError(encode({ ...walkPayload, upstreamCode: 'model_not_found' }))
      expect(report.kind).toBe('model-unavailable-upstream')
      expect(`${report.reason} ${report.hint}`).not.toMatch(/ratio|aspect|size|比例|尺寸|参数/i)
      expect(report.hint).toMatch(language === 'en' ? /switch to another model/i : /换个模型/)
      expect(report.hint).not.toMatch(/稍等|稍后再试|try again later/i)
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })
})

describe('标题永远是界面语言的一句话；供应商的话只进「服务商原话」（2026-09-29：中文界面顶着供应商的英文原话）', () => {
  const encode = (structured: Record<string, unknown>) =>
    `Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: Provider request failed`
  const sixEnglishWords = /[A-Za-z][A-Za-z'-]*(?:[\s,.:;()]+[A-Za-z][A-Za-z'-]*){5,}/
  // 这些话没有任何一个分类器认得（不是余额 / 限流 / 下线 / 审核 / 参数），落到 unknown。
  const UNCLASSIFIED = [
    'Unexpected upstream condition while rendering the frame sequence for this request.',
    'The render farm returned an unrecognised state after the third checkpoint.',
  ]

  it.each(UNCLASSIFIED)('中文界面：结构化载荷里的英文原话不进标题也不进提示——%s', (upstreamMsg) => {
    const report = classifyGenerationError(encode({ vendorKey: 'x', httpStatus: 404, category: 'unknown', upstreamMsg }))
    expect(report.kind).toBe('unknown')
    expect(report.reason).toBe('生成失败')
    expect(sixEnglishWords.test(report.reason)).toBe(false)
    expect(sixEnglishWords.test(report.hint)).toBe(false)
    expect(report.providerMessage).toBe(upstreamMsg)
  })

  it('异步任务失败的形状同理：标题是界面语言，原话在次要那一格，内部的 taskId 后缀不进标题', () => {
    const report = classifyGenerationError(`${UNCLASSIFIED[0]} (taskId=task_01ABC, kind=text_to_image)`)
    expect(report.reason).toBe('生成失败')
    expect(report.reason).not.toContain('taskId')
    expect(report.providerMessage).toBe(UNCLASSIFIED[0])
  })

  it('同一种语言的原话可以当标题（读得懂，也更具体）', () => {
    const said = '当前模型排队人数过多，请等一会儿再来'
    const report = classifyGenerationError(encode({ vendorKey: 'x', httpStatus: 404, category: 'unknown', upstreamMsg: said }))
    expect(report.reason).toBe(said)
    expect(report.providerMessage).toBeUndefined()
  })

  it('英文界面对称：中文原话不进标题', async () => {
    await i18n.changeLanguage('en')
    try {
      const said = '当前模型排队人数过多，请等一会儿再来'
      const report = classifyGenerationError(encode({ vendorKey: 'x', httpStatus: 404, category: 'unknown', upstreamMsg: said }))
      expect(report.reason).toBe('Generation failed')
      expect(report.reason).not.toMatch(/[㐀-鿿]/)
      expect(report.providerMessage).toBe(said)
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })

  it('我们自己的话不受这条规矩牵连：认不出来源的照旧抠首行当标题（不把具体的话换成泛泛的「生成失败」）', () => {
    expect(classifyGenerationError('请先写点提示词再生成。').reason).toBe('请先写点提示词再生成。')
    expect(classifyGenerationError('模型任务执行失败 (taskId=t_1, kind=text_to_image)').providerMessage).toBeUndefined()
  })
})

describe('供应商已经把结果发回来了、Nomi 没能读出来：说读不出来，不栽给服务商', () => {
  const unreadable = tagNomiError('output-unreadable', 'Generated media validation failed (decode_failed)')
  const sixWords = (text: string): boolean => /[A-Za-z][A-Za-z'-]*(?:[\s,.:;()]+[A-Za-z][A-Za-z'-]*){5,}/.test(text)

  it('按机器码归类：不再落进 unknown 的「可能是服务商临时故障或额度问题，换一个模型」', () => {
    const report = classifyGenerationError(unreadable)
    expect(report.kind).toBe('output-unreadable')
    expect(report.reason).toBe('生成的文件没能读出来')
    expect(`${report.reason}${report.hint}`).not.toMatch(/服务商临时故障|额度问题|换一个模型|换个模型/)
    expect(sixWords(report.reason + report.hint)).toBe(false)
  })

  it('只有重试：换供应商不是它的解法（动作表里这一类没有第二个动作）', () => {
    const report = classifyGenerationError(unreadable)
    expect(report.primary).toBe('retry')
    expect(report.secondary).toBeNull()
  })

  it('那句英文校验串不印进「服务商原话」（服务商已经把图发回来了），技术详情里照留', () => {
    const report = classifyGenerationError(unreadable)
    expect(report.providerMessage).toBeUndefined()
    expect(report.raw).toContain('decode_failed')
    expect(report.raw).not.toContain('NOMI_ERR::')
  })

  it('所有「生成产物校验失败」的原因走同一个码（decode / 冒充网页 / 认不出字节 / 类型不符 / 格式不支持）', () => {
    for (const reason of ['decode_failed', 'decode_unverified', 'markup_masquerade', 'unknown_bytes', 'kind_mismatch', 'unsupported_format', 'evidence_mismatch']) {
      expect(classifyGenerationError(tagNomiError('output-unreadable', `Generated media validation failed (${reason})`)).kind).toBe('output-unreadable')
    }
  })

  it('英文界面同样是英文', async () => {
    await i18n.changeLanguage('en')
    try {
      const report = classifyGenerationError(unreadable)
      expect(report.reason).toBe('The generated file could not be read')
      expect(report.reason + report.hint).not.toMatch(/[㐀-鿿]/)
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })
})

// 点名供应商说「它失败了」之前必须先问：这是服务商那一侧的事吗？（2026-09-29 pb06：本机判失败之后提示劝换一家）
describe('vendorSide —— 失败是不是服务商那一侧的事', () => {
  const structuredMessage = (structured: Record<string, unknown>, tail: string) =>
    `Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`

  it.each([
    ['供应商回 400：模型已下线', structuredMessage({ vendorKey: 'x', httpStatus: 400, category: 'input', upstreamMsg: 'This model has been deprecated and is no longer available.', upstreamCode: 'model_not_found' }, 'Provider request failed (HTTP 400)')],
    ['供应商回 401', structuredMessage({ vendorKey: 'x', httpStatus: 401, category: 'auth', upstreamMsg: 'invalid key' }, 'Provider request failed (HTTP 401)')],
    ['供应商回 500', structuredMessage({ vendorKey: 'x', httpStatus: 500, category: 'server', upstreamMsg: 'boom' }, 'Provider request failed (HTTP 500)')],
    ['没被任何一类认出、但供应商说了话', structuredMessage({ vendorKey: 'x', httpStatus: 404, category: 'unknown', upstreamMsg: 'Unexpected upstream condition while rendering the frame sequence.' }, 'Provider request failed (HTTP 404)')],
    ['异步任务在供应商那边失败', 'Insufficient balance on the upstream account (taskId=t_1, kind=text_to_image)'],
    ['老格式的 401 字符串（旧数据）', '401 Unauthorized — invalid api key'],
  ])('是：%s', (_label, message) => {
    expect(classifyGenerationError(message).vendorSide).toBe(true)
  })

  it.each([
    ['结果已送达、本机读不出来', tagNomiError('output-unreadable', 'Generated media validation failed (decode_failed)')],
    ['参考素材本身不行（请求没发出）', tagNomiError('asset-invalid', '参考素材读取失败')],
    ['我们自己的出站策略拦了提交（走的是 VendorRequestError 的壳）', structuredMessage({ vendorKey: 'x', category: 'network', upstreamMsg: 'refused' }, `Provider request refused by outbound policy: ${tagNomiError('outbound-blocked-submit', 'blocked')}`)],
    ['取片被出站策略拦了', tagNomiError('outbound-blocked', 'blocked')],
    ['模型已被我们下线', 'Model is retired: sora-2'],
    ['图生图缺参考图的本机护栏（归 input 类，但请求没出门）', '图生图缺少参考图：这次请求里没有任何图片可以发给模型。'],
    ['我们自己中文的本机护栏（没有供应商说的话）', '请先写点提示词再生成。'],
    ['内部英文错误（没有供应商说的话）', 'node not found'],
  ])('否：%s', (_label, message) => {
    expect(classifyGenerationError(message).vendorSide).toBe(false)
  })
})

// 认不出的失败如实说「认不出」（F6，2026-09-30）。旧文案对每一个没有分类器认得的失败都说「可能是服务商临时故障或额度问题」——
// 其中「额度」是猜的：今天没有价格，猜额度只会把人引去查账。目录不认识的失败就说不认识，不编原因；
// 供应商给了码就带上码，原文（「服务商原话」）和完整报文（「技术详情」）留着当入口。
describe('认不出的失败如实说认不出：不编原因、不提额度，附上供应商的码与原文入口（F6）', () => {
  const structuredMessage = (structured: Record<string, unknown>, tail = 'Provider request failed') =>
    `Error: NOMI_VENDOR_ERR_B64::${Buffer.from(JSON.stringify(structured), 'utf8').toString('base64')}:: ${tail}`
  // 说出任何一种「原因」的词：临时故障 / 额度 / 余额 / 限流——认不出的失败一个都不许说。
  const GUESSED_CAUSE = /临时故障|额度|余额|限流|credit|quota|balance|temporar|rate.?limit/i
  const UNRECOGNIZED = 'The render farm returned an unrecognised state after the third checkpoint.'

  it('没有任何证据（连供应商的话都没有）→ 说认不出，一个原因都不编', () => {
    const report = classifyGenerationError('something odd happened')
    expect(report.kind).toBe('unknown')
    expect(report.hint).toContain('没能认出这次失败的原因')
    expect(report.hint).toContain('技术详情')
    expect(`${report.reason}${report.hint}`).not.toMatch(GUESSED_CAUSE)
    // 没有码就不写「错误码」这一句
    expect(report.hint).not.toContain('错误码')
  })

  it('供应商给了错误码 → 说明里带上这个码（有码就带，不靠猜）', () => {
    // 真实形状：主进程的失败信息尾巴里带着供应商原话（技术详情读的就是它）。
    const report = classifyGenerationError(structuredMessage(
      { vendorKey: 'x', httpStatus: 418, category: 'unknown', upstreamMsg: UNRECOGNIZED, upstreamCode: 'render_farm_state' },
      `Provider request failed (HTTP 418) at x POST https://x.invalid/v1/images: ${UNRECOGNIZED}`,
    ))
    expect(report.kind).toBe('unknown')
    expect(report.hint).toContain('没能认出这次失败的原因')
    expect(report.hint).toContain('服务商给的错误码是 render_farm_state')
    expect(`${report.reason}${report.hint}`).not.toMatch(GUESSED_CAUSE)
    // 原文入口：供应商的话在「服务商原话」那一格，完整报文在 raw（技术详情）
    expect(report.providerMessage).toBe(UNRECOGNIZED)
    expect(report.raw).toContain(UNRECOGNIZED)
  })

  it('三条 unknown 出口都带码：供应商的话是界面语言 / 不是界面语言 / 根本没有话（只有码）', () => {
    const inUiLanguage = classifyGenerationError(structuredMessage({ vendorKey: 'x', httpStatus: 418, category: 'unknown', upstreamMsg: '当前模型排队人数过多，请等一会儿再来', upstreamCode: 'queue_busy' }))
    const outOfUiLanguage = classifyGenerationError(structuredMessage({ vendorKey: 'x', httpStatus: 418, category: 'unknown', upstreamMsg: UNRECOGNIZED, upstreamCode: 'queue_busy' }))
    const codeOnly = classifyGenerationError(structuredMessage({ vendorKey: 'x', httpStatus: 418, category: 'unknown', upstreamCode: 'queue_busy' }))
    for (const report of [inUiLanguage, outOfUiLanguage, codeOnly]) {
      expect(report.kind).toBe('unknown')
      expect(report.hint).toContain('服务商给的错误码是 queue_busy')
    }
  })

  it('供应商只给了业务码（logicalCode，HTTP 200 里的错误信封）→ 也带上', () => {
    const report = classifyGenerationError(structuredMessage({ vendorKey: 'x', logicalCode: 90417, category: 'unknown', upstreamMsg: UNRECOGNIZED }))
    expect(report.kind).toBe('unknown')
    expect(report.hint).toContain('服务商给的错误码是 90417')
  })

  it('英文界面同样：不猜、带码；说明里没有中文', async () => {
    await i18n.changeLanguage('en')
    try {
      const withCode = classifyGenerationError(structuredMessage({ vendorKey: 'x', httpStatus: 418, category: 'unknown', upstreamMsg: UNRECOGNIZED, upstreamCode: 'render_farm_state' }))
      expect(withCode.hint).toContain('Nomi could not tell what caused this failure, so it will not guess.')
      expect(withCode.hint).toContain('The provider’s error code is render_farm_state')
      expect(withCode.hint).toContain('Technical details')
      expect(`${withCode.reason}${withCode.hint}`).not.toMatch(GUESSED_CAUSE)
      expect(withCode.hint).not.toMatch(/[㐀-鿿]/)
      const bare = classifyGenerationError('something odd happened')
      expect(bare.hint).toContain('will not guess')
      expect(bare.hint).not.toContain('error code')
      expect(`${bare.reason}${bare.hint}`).not.toMatch(GUESSED_CAUSE)
    } finally {
      await i18n.changeLanguage('zh-CN')
    }
  })

  it('认得的类别不受影响：该说余额 / 限流 / 服务商故障的，照说（有证据才说）', () => {
    const kinds = [
      ['402', structuredMessage({ vendorKey: 'x', httpStatus: 402, category: 'balance', upstreamMsg: 'insufficient balance' }), 'balance'],
      ['429', structuredMessage({ vendorKey: 'x', httpStatus: 429, category: 'quota', upstreamMsg: 'too many requests' }), 'quota'],
      ['500', structuredMessage({ vendorKey: 'x', httpStatus: 500, category: 'server', upstreamMsg: 'boom' }), 'server'],
    ] as const
    for (const [, message, kind] of kinds) expect(classifyGenerationError(message).kind).toBe(kind)
  })

  it('认不出的失败里没有一个是「服务商临时故障 / 额度」的猜测：unknown 的两条文案在中英各一遍都不含它', async () => {
    for (const language of ['zh-CN', 'en'] as const) {
      await i18n.changeLanguage(language)
      try {
        for (const key of ['hint', 'hintWithCode'] as const) {
          const text = i18n.t(`generationCommon.observability.error.unknown.${key}`, { code: 'X' })
          expect(text, `${language} unknown.${key}`).not.toMatch(GUESSED_CAUSE)
          expect(text).not.toContain('generationCommon.')
        }
      } finally {
        await i18n.changeLanguage('zh-CN')
      }
    }
  })
})
