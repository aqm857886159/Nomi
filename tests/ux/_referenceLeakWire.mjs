// 参考图「界面标为在用 = 真发出去」的真付费样本判定（纯函数，不起 App、不花钱就能单测）。
// 用它的付费走查：composer-b3-reference.paid.mjs（B3 版；步骤本体在 _composerB3ReferenceSteps.mjs）。
// 10-22 热修 #1279 的旧脚本 reference-leak-hotfix.paid.mjs 已随 B3「守卫只剥不拒 → 拒发」删掉（构建标记失效，跑不起来）。
//
// 三件事：
//   · firstLastSceneProblems：花钱前，节点 meta 上场景布好了没（B3 规范形：一份有序参考列表）；
//   · judgeReferenceWire：花钱后，App 真正发往供应商的那一次视频创建请求里带了哪些图。输入是走查网络闸的账本条目
//     （scripts/walkthrough-network-guard.cjs 在 NOMI_WALK_NET_BODIES=1 时写的 `allowed-request` / `allowed-response`）；
//   · referenceRejection：主进程参考守有没有拒发（机器码 reference-not-in-use），落在节点上的报错里读。
//
// 两条要点（V-refleak 第 1 轮的条件）：
//   · 首尾帧各出现一次，按角色对回本地文件名；重复地址、扁平键或颠倒顺序都判失败。
//   · **残留参考的任何形态都不许出现**：文件名、本地地址、托管上传后的公网地址（地址哈希），在请求体里和托管上传里都不许有。
import crypto from 'node:crypto'
import { canonicalEvidenceUrl } from '../../scripts/walkthrough-url-shape.cjs'

/** URL 去掉查询串（签名参数）后的样子；闸已经把查询串换成 `?<redacted>`。 */
export function bareUrl(url) {
  try { return canonicalEvidenceUrl(url) } catch { return null }
}

export function shortHash(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 12)
}

function urlsIn(value, out = []) {
  if (typeof value === 'string') { if (/^(https?:|data:|nomi-local:)/i.test(value)) out.push(value) }
  else if (Array.isArray(value)) value.forEach((item) => urlsIn(item, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => urlsIn(item, out))
  return out
}

const MEDIA_NOT_IMAGE = /\.(mp4|mov|webm|mp3|wav|m4a)$/i

/**
 * @param {Array<Record<string, any>>} entries 闸的账本条目
 * @param {{ host: string, firstFile: string, lastFile: string, referenceFiles: string[], localUrlOf?: (file: string) => string }} scene
 * @returns {{ problems: string[], summary: Record<string, unknown> }}
 */
export function judgeReferenceWire(entries, { host, firstFile, lastFile, referenceFiles, localUrlOf }) {
  const problems = []
  const expected = [firstFile, lastFile].sort()
  const creates = entries.filter((entry) => entry.kind === 'allowed-request' && entry.host === host && entry.method === 'POST' && /\/videos\/generations$/.test(new URL(entry.url).pathname))
  if (creates.length !== 1) problems.push(`发往 ${host} 的视频创建请求有 ${creates.length} 次（应恰好 1 次）`)
  const bodyText = String(creates[0]?.body?.text ?? '')
  let body = null
  try { body = bodyText ? JSON.parse(bodyText) : null } catch { problems.push('创建请求的请求体不是 JSON（或被截断）') }
  if (creates[0]?.body?.truncated) problems.push('创建请求的请求体超过记账上限被截断，图片地址可能没读全')

  // 托管上传：multipart 记了文件名；同一个 seq 的响应里带着公网地址。
  const uploads = entries.filter((entry) => entry.kind === 'allowed-request' && Array.isArray(entry.body?.form))
    .flatMap((entry) => entry.body.form.filter((part) => part.fileName).map((part) => ({ seq: entry.seq, fileName: String(part.fileName) })))
  const fileByRemote = new Map()
  for (const upload of uploads) {
    const response = entries.find((entry) => entry.kind === 'allowed-response' && entry.seq === upload.seq)
    const responseValue = (() => {
      try { return response?.text ? JSON.parse(String(response.text)) : null } catch { return null }
    })()
    for (const url of urlsIn(responseValue).filter((value) => /^https?:/i.test(value))) {
      const canonical = bareUrl(url)
      if (canonical) fileByRemote.set(canonical, upload.fileName)
    }
  }
  for (const file of [...referenceFiles, firstFile, lastFile]) if (localUrlOf) {
    const canonical = bareUrl(localUrlOf(file))
    if (canonical) fileByRemote.set(canonical, file)
  }

  // 唯一地址用于匹配上传来源；原始出现次数独立保留，避免去重掩盖重复提交。
  const rawImageUrls = body ? urlsIn(body).filter((url) => {
    const canonical = bareUrl(url)
    return canonical && !MEDIA_NOT_IMAGE.test(canonical)
  }) : []
  const uniqueImageUrls = [...new Set(rawImageUrls.map(bareUrl).filter(Boolean))]
  if (rawImageUrls.length !== 2 || uniqueImageUrls.length !== 2 || Object.hasOwn(body ?? {}, 'image_urls')) {
    problems.push('首尾帧应各出现一次，只落在角色数组')
  }
  const roles = Array.isArray(body?.image_with_roles) ? body.image_with_roles : []
  if (roles.length !== 2 || roles[0]?.role !== 'first_frame' || roles[1]?.role !== 'last_frame'
    || fileByRemote.get(bareUrl(roles[0]?.url)) !== firstFile || fileByRemote.get(bareUrl(roles[1]?.url)) !== lastFile) {
    problems.push('首帧、尾帧的角色和文件顺序必须对应')
  }
  const sent = uniqueImageUrls.map((url) => ({ file: fileByRemote.get(url) ?? null, urlSha256: shortHash(url) }))
  const sentFiles = sent.map((entry) => entry.file)
  if (sentFiles.some((file) => file === null)) problems.push(`请求体里有 ${sentFiles.filter((file) => file === null).length} 张图对不回本地文件名（托管上传没记到，或换了别的上传形状）——证明不了只发了首帧、尾帧`)
  if (JSON.stringify([...sentFiles].sort()) !== JSON.stringify(expected)) problems.push(`请求体里的图（去重后）是 ${sentFiles.map((file) => file ?? '?').join('、') || '（没有）'}，应恰好是 ${expected.join('、')}`)

  // 残留参考的任何形态：文件名、本地地址、托管后的公网地址（报告里只露地址哈希）。
  const referenceForms = new Set(referenceFiles)
  for (const file of referenceFiles) if (localUrlOf) referenceForms.add(localUrlOf(file))
  const referenceRemote = [...fileByRemote].filter(([, file]) => referenceFiles.includes(file)).map(([url]) => url)
  for (const url of referenceRemote) referenceForms.add(url)
  const inBody = [...referenceForms].filter((form) => bodyText.includes(form))
  if (inBody.length) problems.push(`残留参考出现在请求体里：${inBody.map((form) => (form.startsWith('http') ? shortHash(form) : form)).join('、')}`)
  const uploadedFiles = [...new Set(uploads.map((upload) => upload.fileName))].sort()
  const leakedUploads = uploadedFiles.filter((file) => referenceFiles.includes(file))
  if (leakedUploads.length) problems.push(`界面上没在用的参考图被托管上传了：${leakedUploads.join('、')}`)
  if (uploadedFiles.some((file) => !expected.includes(file))) problems.push(`托管上传的文件是 ${uploadedFiles.join('、')}（应只有 ${expected.join('、')}）`)

  return {
    problems,
    summary: {
      createRequests: creates.length,
      endpoint: creates[0] ? `${new URL(creates[0].url).host}${new URL(creates[0].url).pathname}` : null,
      imageUrlOccurrences: rawImageUrls.length,
      imagesInBody: sent,
      hostedUploads: uploadedFiles,
      problems,
    },
  }
}

/**
 * 花钱前的场景核对（②③）：B3 节点上只存一份有序参考列表（meta.referenceImageUrls），首尾帧方式下列表前两张依次落首帧、尾帧，
 * 其余「未用到」（src/workbench/generationCanvas/nodes/controls/referenceList.ts 文件头）。这里只核**存的事实**，不推导谁在用——
 * 谁在用归 B3 的唯一推导，花钱前从界面上读（_composerReferenceRow.mjs），花钱后从请求体读（judgeReferenceWire）。
 * @param {Record<string, any> | undefined} meta
 * @param {{ firstFile: string, lastFile: string, referenceFiles: string[], localUrlOf: (file: string) => string }} scene
 * @returns {string[]} 问题清单（空 = 场景布好了）
 */
export function firstLastSceneProblems(meta, { firstFile, lastFile, referenceFiles, localUrlOf }) {
  const problems = []
  const list = Array.isArray(meta?.referenceImageUrls) ? meta.referenceImageUrls : []
  const nameOf = (url) => [firstFile, lastFile, ...referenceFiles].find((file) => localUrlOf(file) === url) ?? 'other'
  if (meta?.archetype?.modeId !== 'firstlast') problems.push(`当前方式是 ${meta?.archetype?.modeId ?? '（没有）'}，不是首尾帧`)
  if (list[0] !== localUrlOf(firstFile) || list[1] !== localUrlOf(lastFile)) {
    problems.push(`参考列表最前面两张不是 ${firstFile}、${lastFile}（首尾帧方式下列表前两张依次落首帧、尾帧）：${list.map(nameOf).join('、') || '（空）'}`)
  }
  if (meta?.referenceFirstFrameEmpty === true) problems.push('首帧被标成「特意空着」（referenceFirstFrameEmpty）：列表第一张会落尾帧')
  const missing = referenceFiles.filter((file) => !list.includes(localUrlOf(file)))
  if (missing.length) problems.push(`那 ${referenceFiles.length} 张参考不全在节点的参考列表里（场景没布好，这条付费证明不了什么）：缺 ${missing.join('、')}`)
  return problems
}

// 主进程参考守拒发时抛的机器码（electron/shared/nomiErrorCodes.ts 的 reference-not-in-use；标记形如 `NOMI_ERR::<码>::`）。
const REJECTION_MARKER = /NOMI_ERR::reference-not-in-use::/

/**
 * 主进程参考守（electron/tasks/referenceResidueGuard.ts）有没有拒发这个镜头的请求。渲染层把失败消息**原样**存进节点
 * （generationRunController：Store the RAW message），码标记穿过 IPC 的包装（`Error invoking remote method …`）还在。
 * @param {Record<string, any> | null | undefined} node 盘上或 store 里的画布节点
 * @returns {{ where: string, excerpt: string } | null} 拒发落在哪（node.error / runs[i].error）与前 240 字；没有拒发 → null
 */
export function referenceRejection(node) {
  const places = [['node.error', node?.error], ...(Array.isArray(node?.runs) ? node.runs : []).map((run, index) => [`runs[${index}].error`, run?.error])]
  for (const [where, text] of places) {
    if (typeof text === 'string' && REJECTION_MARKER.test(text)) return { where, excerpt: text.slice(0, 240) }
  }
  return null
}
