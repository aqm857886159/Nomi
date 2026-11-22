// 旧版真实数据的名册：由 tests/fixtures/old-user-data 的目录派生，不手写第二份。
// 一份「可单独拷出来用的旧数据」= 含 model-catalog.json 的目录（目录 / 设置），或 projects/ 的直接子目录（项目库）。
// id = 相对 old-user-data 的路径（seedOldUserData 收这个）；名字 name = 去掉分类前缀后的短名（ui.mjs 的 --data 收这个）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OLD_USER_DATA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/old-user-data')
/** 旧数据 json 里的占位符：拷出来时换成目标根（项目里的 lastKnownRootPath 一类）。 */
export const OLD_USER_ROOT_PLACEHOLDER = '__OLD_USER_ROOT__'

function walk(dir, rel, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const parts = rel ? rel.split('/') : []
  if (entries.some((entry) => entry.name === 'model-catalog.json')) {
    out.push({ id: rel, kind: 'settings' })
    return // 已是一份目录：不再往里找
  }
  if (parts.length === 2 && parts[0] === 'projects') {
    out.push({ id: rel, kind: 'projects' })
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'generators' || entry.name.startsWith('.')) continue
    walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, out)
  }
}

/** 从目录派生的全部旧数据：[{ id, kind: 'settings' | 'projects', name }]。 */
export function listOldUserData(root = OLD_USER_DATA_ROOT) {
  const found = []
  walk(root, '', found)
  return found.map((item) => {
    const parts = item.id.split('/')
    const name = parts.slice(1).join('-')
    return { ...item, name }
  })
}

export function resolveOldUserData(idOrName, root = OLD_USER_DATA_ROOT) {
  const all = listOldUserData(root)
  const hit = all.find((item) => item.id === idOrName) ?? all.find((item) => item.name === idOrName)
  if (!hit) throw new Error(`old_user_data_unknown: 旧数据「${idOrName}」不在 tests/fixtures/old-user-data 里。可选：${all.map((item) => item.id).join(' / ')}`)
  return { ...hit, dir: path.join(root, hit.id) }
}

/** 把一份旧数据拷到 destDir（json 里的占位符换成 destDir；按 JSON 转义，Windows 路径的反斜杠不会弄坏文件）。 */
export function copyOldUserData(sourceDir, destDir, replacement = JSON.stringify(destDir).slice(1, -1)) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name)
    const to = path.join(destDir, entry.name)
    if (entry.isDirectory()) copyOldUserData(from, to, replacement)
    else if (entry.name.endsWith('.json')) fs.writeFileSync(to, fs.readFileSync(from, 'utf8').split(OLD_USER_ROOT_PLACEHOLDER).join(replacement))
    else fs.copyFileSync(from, to)
  }
}
