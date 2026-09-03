import fs from 'node:fs'
import { createLogger, defineConfig, loadEnv, type ConfigEnv, type Logger, type Plugin, type UserConfig } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'

const NOMI_TAILWIND_CSS_PATH = '/tailwind.generated.css'
const NOMI_TAILWIND_CSS_FILE = resolve(__dirname, 'public', 'tailwind.generated.css')

function nomiStaticAssetPlugin(): Plugin {
  return {
    name: 'nomi-static-assets',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url === NOMI_TAILWIND_CSS_PATH) {
          fs.readFile(NOMI_TAILWIND_CSS_FILE, (error, css) => {
            if (error) {
              next()
              return
            }
            res.statusCode = 200
            res.setHeader('content-type', 'text/css; charset=utf-8')
            res.setHeader('cache-control', 'no-cache')
            res.end(css)
          })
          return
        }
        next()
      })
    },
  }
}

// onnxruntime-web 自带一句 `new URL("ort-wasm-simd-threaded.jsep.wasm", import.meta.url)`
// 作为「调用方没设 wasmPaths 时」的兜底路径。Vite 认得这个模式，会把那份 22.8MiB 的 .wasm
// 当静态资产 emit 进 dist/ 并打进安装包。
//
// 但这条兜底在 Nomi 里永远走不到：抠图是 onnxruntime-web 的唯一入口（pnpm why 确认它只作为
// @imgly/background-removal 的 peer 存在），而 @imgly 在 createOnnxSession 里、于
// InferenceSession.create 之前**无条件**把 ort.env.wasm.wasmPaths 指向自己的 CDN
// （node_modules/@imgly/background-removal/dist/index.mjs:1017-1021）。两处兜底都以
// `!wasmPaths` 为前提，故都是死代码——我们为一份运行时永不读取的文件付了 22.8MiB 包体。
//
// 这里把该表达式换成同类型的字符串常量：Vite 不再认出资产引用、不再 emit .wasm，
// 而万一将来有人绕开 @imgly 直接用 ort 且不设 wasmPaths，取到的是这个显式路径而不是
// 一个静默的坏 URL——失败会说人话，不会退化成「模型莫名加载不出来」。
// 守卫：src/lib/removeBackgroundBundle.test.ts 断言 @imgly 仍然自设 wasmPaths；
// 一旦升级后它不再自设，那条测试先红，提醒把这个插件撤掉。
const ORT_DEAD_WASM_FALLBACK = 'new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url).href'

function nomiDropDeadOrtWasmAsset(): Plugin {
  return {
    name: 'nomi-drop-dead-ort-wasm-asset',
    apply: 'build',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!id.includes('onnxruntime-web')) return null
      if (!code.includes(ORT_DEAD_WASM_FALLBACK)) return null
      return {
        code: code.split(ORT_DEAD_WASM_FALLBACK).join('"ort-wasm-simd-threaded.jsep.wasm"'),
        map: null,
      }
    },
  }
}

function isKnownDevDependencyWarning(message: string): boolean {
  return (
    message.includes('The above dynamic import cannot be analyzed by Vite') && message.includes('react-router-dom.js')
  )
}

function createNomiLogger(): Logger {
  const logger = createLogger()
  const warn = logger.warn.bind(logger)
  logger.warn = (message, options) => {
    if (typeof message === 'string' && isKnownDevDependencyWarning(message)) return
    warn(message, options)
  }
  return logger
}

function createManualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, '/')

  if (
    normalizedId.includes('vite/preload-helper') ||
    normalizedId.includes('commonjsHelpers') ||
    normalizedId.includes('/node_modules/@babel/runtime/helpers/') ||
    normalizedId.includes('/node_modules/@babel/helpers/') ||
    normalizedId.includes('/node_modules/tslib/')
  ) {
    return 'runtime-vendor'
  }
  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/') ||
    normalizedId.includes('/node_modules/use-sync-external-store/')
  ) {
    return 'react-vendor'
  }
  if (normalizedId.includes('/node_modules/zustand/') || normalizedId.includes('/node_modules/immer/')) {
    return 'state-vendor'
  }
  if (normalizedId.includes('/node_modules/clsx/') || normalizedId.includes('/node_modules/tailwind-merge/')) {
    return 'ui-vendor'
  }
  if (normalizedId.includes('/node_modules/@photo-sphere-viewer/core/')) {
    return 'panorama-vendor'
  }
  if (
    normalizedId.includes('/node_modules/prosemirror-') ||
    normalizedId.includes('/node_modules/orderedmap/') ||
    normalizedId.includes('/node_modules/w3c-keyname/')
  ) {
    return 'prosemirror-vendor'
  }
  if (normalizedId.includes('/node_modules/@tiptap/') || normalizedId.includes('/node_modules/@prosemirror')) {
    return 'tiptap-vendor'
  }
  if (
    normalizedId.includes('/node_modules/react-markdown/') ||
    normalizedId.includes('/node_modules/remark-') ||
    normalizedId.includes('/node_modules/rehype-') ||
    normalizedId.includes('/node_modules/unified/') ||
    normalizedId.includes('/node_modules/mdast-') ||
    normalizedId.includes('/node_modules/hast-')
  ) {
    return 'markdown-vendor'
  }
  if (normalizedId.includes('/node_modules/three/')) return 'three-vendor'
  if (
    normalizedId.includes('/node_modules/@react-three/') ||
    normalizedId.includes('/node_modules/three-stdlib/') ||
    normalizedId.includes('/node_modules/tunnel-rat/') ||
    normalizedId.includes('/node_modules/suspend-react/')
  ) {
    return 'r3f-vendor'
  }
  if (normalizedId.includes('/src/ui/stats/')) return 'app-stats'
  if (normalizedId.includes('/src/api/')) return 'app-api'
  return undefined
}

const DEFERRED_MODULE_PRELOAD_PATTERNS: RegExp[] = [
  /^AssetLibraryPanel-/,
  /^BaseGenerationNode-/,
  /^BatchPlanOverlay-/,
  /^CameraMoveCaptureHost-/,
  /^CanvasAssistantPanel-/,
  /^JourneyTourController-/,
  /^Model3DViewer-/,
  /^NodeGenerationComposer-/,
  /^PanoramaViewer-/,
  /^PromptLibraryPanel-/,
  /^Scene3DEditor-/,
  /^Scene3DFullscreen-/,
  /^SkillLibraryPanel-/,
  /^SpendConfirmDialog-/,
  /^StagingCaptureHost-/,
  /^TextDocumentNode-/,
  /^WhiteboardCardBody-/,
  /^applyCanvasToolCall-/,
  /^cameraMove/,
  /^demoProject-/,
  /^generationRunController-/,
  /^journeyTourStore-/,
  /^panorama-vendor-/,
  /^prosemirror-vendor-/,
  /^r3f-vendor-/,
  /^scene3d/,
  /^three-vendor-/,
  /^tiptap-vendor-/,
]

function shouldDeferModulePreload(dep: string): boolean {
  const fileName = dep.split('/').pop() ?? dep
  if (!fileName.endsWith('.js')) return false
  return DEFERRED_MODULE_PRELOAD_PATTERNS.some((pattern) => pattern.test(fileName))
}

export default defineConfig(async ({ command, mode }: ConfigEnv): Promise<UserConfig> => {
  const react = (await import('@vitejs/plugin-react')).default

  loadEnv(mode, process.cwd(), 'VITE_')

  if (command === 'build' && mode !== 'production') {
    throw new Error(`[nomi] Dev build is disabled. Use \`vite build --mode production\` (current mode: ${mode}).`)
  }

  return {
    base: './',
    cacheDir: resolve(__dirname, '.tmp/vite'),
    customLogger: createNomiLogger(),
    plugins: [nomiStaticAssetPlugin(), nomiDropDeadOrtWasmAsset(), react()],
    resolve: {
      dedupe: ['react', 'react-dom', 'scheduler', 'use-sync-external-store', 'three'],
      alias: [
        {
          find: /^react$/,
          replacement: resolve(__dirname, 'node_modules/react/index.js'),
        },
        {
          find: /^react\/jsx-runtime$/,
          replacement: resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        },
        {
          find: /^react\/jsx-dev-runtime$/,
          replacement: resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: /^react-dom$/,
          replacement: resolve(__dirname, 'node_modules/react-dom/index.js'),
        },
        {
          find: /^react-dom\/client$/,
          replacement: resolve(__dirname, 'node_modules/react-dom/client.js'),
        },
        {
          find: /^three$/,
          replacement: resolve(__dirname, 'node_modules/three'),
        },
        {
          find: /^@tabler\/icons-react$/,
          replacement: resolve(__dirname, 'src/vendor/tablerIcons.ts'),
        },
      ],
    },
    server: {
      port: 5273,
      host: true,
      cors: true,
      // COOP/COEP 跨源隔离默认关：它会卡死 Playwright CDP 握手（R13 走查全挂的真根因）。
      // 仅 ONNX 多线程推理需要时显式开 NOMI_DEV_CROSS_ORIGIN_ISOLATION=1。
      headers:
        process.env.NOMI_DEV_CROSS_ORIGIN_ISOLATION === '1'
          ? {
              'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'require-corp',
            }
          : undefined,
      hmr: process.env.NOMI_DISABLE_VITE_HMR === '1' ? false : undefined,
      fs: {
        allow: [resolve(__dirname)],
      },
    },
    optimizeDeps: {
      entries: ['index.html', 'src/dev/optimizeDepsEntry.ts'],
      force: command === 'serve' && process.env.NOMI_FORCE_VITE_OPTIMIZE_DEPS === '1',
      noDiscovery: true,
      holdUntilCrawlEnd: false,
      esbuildOptions: {
        minify: true,
        sourcemap: false,
      },
      include: [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        '@radix-ui/react-switch',
        '@mantine/core',
        '@mantine/modals',
        '@mantine/notifications',
        '@xmldom/xmldom',
        '@react-three/drei',
        '@react-three/fiber',
        '@react-three/fiber > react-reconciler',
        '@react-three/fiber > react-reconciler/constants',
        '@tanstack/react-virtual',
        '@tiptap/core',
        '@tiptap/extension-placeholder',
        '@tiptap/extension-highlight',
        '@tiptap/extension-list',
        '@tiptap/extension-table',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/suggestion',
        // 富文本内核直接从这些 @tiptap/pm 子路径引 ProseMirror（persistentSelection.ts 用 pm/view+pm/state，
        // 内核 model 归一用 pm/model）。必须与上面的 @tiptap/starter-kit 一起进同一次 esbuild 预打包，
        // 让 prosemirror-* 在优化图里被去重成单实例；漏掉任一条都会让该子路径走未优化的独立 ESM，
        // 与预打包里的实例分裂，触发创作区 Decoration 崩溃（见 resolve.dedupe 注释）。
        '@tiptap/pm/view',
        '@tiptap/pm/state',
        '@tiptap/pm/model',
        '@xmldom/xmldom',
        'clsx',
        'framer-motion',
        'i18next',
        'react-i18next',
        'react-markdown',
        '@photo-sphere-viewer/core',
        'tailwind-merge',
        'swr',
        'three',
        // assetLocalization is reachable from the renderer through catalogTaskActions.
        // @xmldom/xmldom is CommonJS, so Vite must prebundle it before the browser
        // requests the module; otherwise the raw CJS file has no DOMParser export.
        '@xmldom/xmldom',
        'zod',
        'zustand',
        'zustand/middleware',
        'zustand/middleware/immer',
        'zustand/traditional',
      ],
    },
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: true,
      modulePreload: {
        resolveDependencies(_filename: string, deps: string[]) {
          return deps.filter((dep) => !shouldDeferModulePreload(dep))
        },
      },
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
      rollupOptions: {
        output: {
          manualChunks: createManualChunks,
        },
      },
    },
    worker: {
      format: 'es',
      // 抠图 worker 是独立的 Rollup 构建：顶层 plugins 不会自动进来，
      // onnxruntime-web 只在这条链上被 import，所以摘死 wasm 的插件必须挂在这里。
      plugins: () => [nomiDropDeadOrtWasmAsset()],
    },
  }
})
