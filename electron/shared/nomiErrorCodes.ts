// Nomi 自有错误的**机器可读码**（electron-free：主进程 throw、渲染层 classify 都要引，且要能被
// 打包后的裸 Node MCP launcher require，故零 electron/node 顶层导入）。
//
// 为什么要它（root-cause，替换「按中文文案子串分类」那一族）：
//   主进程某处 throw 一句中文人话（如「素材超过所有上传通道的大小上限」），渲染层 classifyError 靠
//   对这句人话做子串匹配把它归成 asset-too-large。两端用**同一句中文人话**当协议——那句一旦被
//   i18n 化 / 改词，分类当场断，而单测多半还绿（喂的就是写死的中文）。典型的「本地看不出、线上换语言才炸」。
//
// 解法与 vendorHttp.ts 的 VENDOR_ERROR_IPC_MARKER 同构：在 message 里嵌一段**稳定的码标记**，
// 它不随人话翻译而变。throw 端 tagNomiError(code, humanMessage) 前缀标记；classify 端
// matchNomiErrorCode(raw) 只认码；展示端 stripNomiErrorCode(raw) 把标记剥掉、只留人话。
// 标记走 message 字符串，因此能穿透 Electron IPC 的 rejection（和 vendor marker 一样，IPC 只剩 message）。

/** 目前纳入码化的自有错误类别。新增一类时在这里加一个稳定字符串常量，别在别处硬编码字面量。 */
export type NomiErrorCode =
  | 'model-config' // 本地目录无可执行模型；恢复动作不依赖可翻译文案
  | 'asset-too-large' // 素材超过所有上传通道的体积上限（HTTP 413 全挂）——确定性失败，得压缩不能重试
  | 'asset-upload-failed' // 所有上传通道都没成功（非 413）——失败在我们这侧，服务商没被请求到
  // 本地参考素材在上传前的本机检查里就没过：读不到、认不出类型、内容不是真正的媒体。
  // 确定性失败，请求没发出、没计费；下一步是换一张或重新导入，不是换服务商。
  | 'asset-invalid'
  // 主进程发送前的参考守（electron/tasks/referenceResidueGuard.ts）：带档案输入的请求里，通用参考键带着
  // 参考区没在用的图。渲染层结构上做不出这种请求（唯一推导 placeUploadedImages），出现 = 有新入口绕过了它。
  // 在发出之前拒：请求没离开本机、服务商没被请求到；下一步是重新点生成（会按参考区重新组一次请求）。
  | 'reference-not-in-use'
  // 用户**明确选了**的画幅比例，这条连接的尺寸字段表达不了（OpenAI 兼容 size 要求长边 ≤ 短边 3 倍，
  // electron/catalog/paramTranslate.ts 的 ratioResToOpenAiSize）。与 reference-not-in-use 同族：构造请求时就拒了，
  // 请求没离开本机、服务商没被请求到。为什么拒而不是悄悄省略 size：省略后服务商按它自己的默认尺寸出图，
  // 用户选的画幅被换成另一个，界面上写的却还是他选的那个。下一步是在生成框里换一个比例（或换一个支持该比例的模型）再生成。
  | 'aspect-ratio-unsupported'
  // Nomi **自己的**出站安全策略拒绝了这次取片（私网/回环/fake-ip 未确证）。与上面几条 asset-* 同族：
  // 失败在我们这侧、服务商根本没被请求到。但它还多一件事——任务**已经付过钱**且上游多半已完成，
  // 所以正确的下一步是「修网络再免费重新拉取」，绝不是「重新生成」（那要再付一次）。
  | 'outbound-blocked'
  // 同一族的**提交侧**：出站策略在付费请求发出**之前**拒了它。与上面一条刻意分家，因为「钱怎么样了」
  // 相反——请求从未离开本机，供应商没被请求到、没有计费，也不存在可找回的 taskId。共用一个码会让
  // 渲染层给出一颗按不动的「重新拉取结果」，并配一句「钱已经付过」的假话。
  | 'outbound-blocked-submit'
  // 带着用户密钥的请求，目的地不是他保存这把 key 时确认过的那个 origin（凭据绑定，
  // catalog/credentialBinding.ts）。与上面两条同族「请求没离开本机、没有计费」，但**下一步不同**：
  // 这里没有网络要修——要么是有人在用户没看见的时候改了地址，要么是他确实换了供应商地址而
  // 还没重新保存密钥。正确的动作是回接入页重新保存一次，不是去看代理。
  | 'outbound-blocked-credential-origin'
  // 带着密钥的请求，对方回了一个跳转（3xx）。Nomi 不跟着走——自定义鉴权头和 POST 正文会被带去第二个网站
  // （fetch 只会在跨域时去掉 Authorization）。请求**已经**到过用户配置的那个地址，所以与上面几条不同：
  // 这里不能说「没发出去 / 没扣费」。下一步是把服务商地址改成跳转后的地址。
  | 'credential-redirect'
  // 供应商**已经把结果发回来了**，但 Nomi 在本机落盘前的校验没能把它当成可用的媒体读出来
  // （解码不出画面、字节认不出、是网页冒充、格式不受支持……见 electron/assets/generatedMediaDecode.ts）。
  // 与 asset-* 不同：那几条是**参考素材**的问题（请求没发出去）；这条是**产物**的问题（请求已经完成）。
  // 所以它不能说「服务商失败了」、不能劝换一家——失败发生在我们这一侧读文件的那一步。
  | 'output-unreadable'
  // 付费提交发出后没拿到回复（连接被重置 / 响应超时 / 提交途中进程退出）：供应商**可能已经收下**，
  // Nomi 没法自动核对。不能说「没发到」，也不能自动重发；下一步是先去服务商后台核对。
  | 'submission-unknown'
  // 供应商已经做完、钱已经花了，但 Nomi 把结果**取回到本机**这一步确定性地没成（出站策略拒、对方答 4xx /
  // 跳转 / 类型不对 / 超上限）。与 outbound-blocked 不同：那条只说「策略拦了、去看网络」；这条覆盖整个
  // 取回失败族，而且下一步只有一个——在任务面板点「重新取回」（免费、不重新生成）。绝不给重试（= 再生成再付钱）。
  | 'output-retrieval-failed'
  // 这一步完全在用户这台电脑上做（ffmpeg 截帧 / 本机深度推理 / 本地素材复制），没有任何服务商参与。
  // 失败原因不在「模型」，所以错误卡只留「重试」，不给「换个模型」。生产者一律走 tagLocalProcessingError（渲染层单一入口）。
  | 'local-processing'
  // 异步任务「结果取回」的阶段码（#1213）。任务**已经被受理、钱多半已经花了**，丢的只是把结果拿回来这一步——
  // 统一落「可找回」（免费重新取回，绝不重新提交），并说清卡在哪一步：
  //   retrieval-query    查任务这一步报错（无可用渠道 / 路由不存在 / 任务号无效 / 网络……）
  //   retrieval-parse    上游有回答，但读不出结果（说成了却没地址 / 状态词认不出）
  //   retrieval-download 有地址，下载到本机没成（出站被拦另有 outbound-blocked）
  //   retrieval-timeout  等到上限还没终态
  // 提交阶段（还没拿到任务号）的失败不在这一族：那时没有可找回的任务，见 submission-* / outbound-blocked-submit。
  | 'retrieval-query'
  | 'retrieval-parse'
  | 'retrieval-download'
  | 'retrieval-timeout'

/**
 * 每个码的话是不是**只在提交之前才成立**（穷举：新增一个码不回答这一问，typecheck 就红）。
 *
 * true = 码的话是「请求还没发出去 / 服务商没被请求到 / 可以放心重新生成」。这些码的生产者（素材本地化、
 * vendorHttp 出站守卫……）被提交和查询共用、不知道自己在哪个阶段，所以取回出口（taskResultQuery.retrievalStageError）
 * 按这张表把它们改挂成取回阶段码：任务已经提交、钱已经花了之后，任何界面都不许再说「没发出去、重新生成吧」
 * （⑬，用户 2026-10-22 拍板）。false = 取回阶段的码，或两个阶段说法都成立（本机处理、服务商地址跳转）。
 */
export const NOMI_ERROR_ONLY_BEFORE_SUBMIT: Readonly<Record<NomiErrorCode, boolean>> = {
  'model-config': true,
  'asset-too-large': true,
  'asset-upload-failed': true,
  'asset-invalid': true,
  // 主进程在 runTask 碰任何网络之前拒发（referenceResidueGuard）：只有提交前这一个生产者，话是「没发出去、重新点生成」。
  'reference-not-in-use': true,
  // 请求构造阶段拒发（只有提交前这一个生产者：create 操作的参数翻译），话是「没发出去、换个比例再生成」。
  'aspect-ratio-unsupported': true,
  'outbound-blocked': false,
  'outbound-blocked-submit': true,
  'outbound-blocked-credential-origin': true,
  'credential-redirect': false,
  'output-unreadable': false,
  'submission-unknown': true,
  'output-retrieval-failed': false,
  'local-processing': false,
  'retrieval-query': false,
  'retrieval-parse': false,
  'retrieval-download': false,
  'retrieval-timeout': false,
}

const MARKER_PREFIX = 'NOMI_ERR::'
const MARKER_SUFFIX = '::'
// 码只用 [a-z-]，标记形如 `NOMI_ERR::asset-too-large:: <人话>`；正则据此从任意位置抠出码。
const MARKER_RE = /NOMI_ERR::([a-z-]+)::/

/** throw 端：给人话消息前缀一段稳定码标记。返回的字符串照旧可读（标记在最前，人话紧随）。 */
export function tagNomiError(code: NomiErrorCode, humanMessage: string): string {
  return `${MARKER_PREFIX}${code}${MARKER_SUFFIX} ${humanMessage}`
}

/** classify 端：从 message 里解出 Nomi 错误码；没有标记 → null（走 legacy 兜底）。 */
export function matchNomiErrorCode(message: string): NomiErrorCode | null {
  const m = MARKER_RE.exec(String(message || ''))
  if (m) return m[1] as NomiErrorCode
  // Frozen pre-code serialization templates from catalogTaskResolve. Decode only
  // whole historical records here; new producers must tag their translated prose.
  // This is a bounded old-data migration, not substring classification.
  const legacyCatalogRecord = /^(?:当前没有已连接的供应商提供「[^」]+」模型。请重新连接原供应商，或在该节点上改选一个已连接供应商的模型。|供应商「[^」]+」已断开，且该节点未记录模型。请重新连接，或在该节点上改选已连接供应商的模型。)$/
  if (legacyCatalogRecord.test(message)) return 'model-config'
  // 单镜 Run 落盘的两句旧话（没带码）：任务号还在、只差再查一次。节点上已经存着它们的旧项目也要按「取回」说话，不给重试。
  return /^(?:生成结果未能安全落入项目，请查看任务并处理|供应商返回了未识别的任务状态，需要人工核对)$/u.test(String(message || '')) ? 'retrieval-query' : null
}

/** 展示端：剥掉码标记，只留人话（技术详情里的 raw 若要保留原样则不调它）。 */
export function stripNomiErrorCode(message: string): string {
  const text = String(message || '')
  const m = MARKER_RE.exec(text)
  if (!m) return text
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim()
}

/**
 * 「结果取回」族：带这些码的失败一律落可找回（任务已受理，免费重新取回），不进红色失败、不重新提交。
 * 不另立一张码表：族 = 上面 NomiErrorCode 里 `retrieval-` 开头的那几个，加出站被拦（取回侧那一条）——
 * 码的唯一定义仍是 NomiErrorCode，新增一个 retrieval-* 阶段码自动归族。
 */
export function isRetrievalStageCode(code: NomiErrorCode | null): code is Extract<NomiErrorCode, `retrieval-${string}` | 'outbound-blocked'> {
  return code !== null && (code.startsWith('retrieval-') || code === 'outbound-blocked')
}
