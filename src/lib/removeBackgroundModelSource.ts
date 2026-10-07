// 抠图模型与运行时**从哪儿拉、拉哪几样、多久没进度算卡住**——唯一一份（worker 与测试都读这里）。
//
// 为什么是我们自己的镜像（2026-10-06 用户拍板方案 ①）：@imgly 默认从 staticimgly.com 拉约 56MB
// （isnet_quint8 模型 44.3MB + ort wasm 11.8MB），国内不走代理时这条外站很慢或拉不动，用户看到的是
// 「首次抠图一直转圈」。随包带会让安装包和每次增量更新都多 56MB，所以放在 Nomi 自己的 R2 公共桶上，
// 文件与官方数据包逐块一致（chunk 名就是内容的 sha256，上传后逐块核过）。
//
// 不留「镜像不通就退回 staticimgly」的分支（P1：新实现不带旧路径当 fallback）——镜像不通就明说失败、给重试。
//
// 升级 @imgly/background-removal 时：数据包版本跟着变，镜像要先传新版本那一套文件，再改这里的版本号。
// `removeBackgroundModelSource.test.ts` 把这里的版本号和装着的 @imgly 包版本钉在一起，漏改就红。

/** @imgly/background-removal-data 的版本——与 @imgly/background-removal 包版本相同（它的默认地址就是用自己的版本号拼的）。 */
export const IMGLY_BACKGROUND_REMOVAL_DATA_VERSION = '1.7.0'

/** 镜像根（结尾必须有 `/`：@imgly 用 `new URL(chunk, publicPath)` 拼每一块的地址）。 */
export const REMOVE_BACKGROUND_PUBLIC_PATH = `https://models.nomiaqm.com/@imgly/background-removal-data/${IMGLY_BACKGROUND_REMOVAL_DATA_VERSION}/dist/`

/** 用哪个模型。镜像里只传了它（fp16 / fp32 没传）——改这里之前先确认镜像里有。 */
export const REMOVE_BACKGROUND_MODEL = 'isnet_quint8' as const

/**
 * CPU 推理时 @imgly 会拉的资源（`resources.json` 里的键）。总进度按这几样的字节总数算，
 * 所以进度条从 0 走到 100 只走一遍（以前按资源各算各的，35% → 100% → 35% → 100% 来回跳）。
 */
export const REMOVE_BACKGROUND_RESOURCE_KEYS = [
  `/models/${REMOVE_BACKGROUND_MODEL}`,
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
] as const

/** 下载中这么久一个字节都没收到，就算卡住：停下、说原因、让用户重试（不无限转圈）。 */
export const REMOVE_BACKGROUND_STALL_MS = 60_000
