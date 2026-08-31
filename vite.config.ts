import fs from 'node:fs';
import { createLogger, defineConfig, loadEnv, type Logger, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';

const NOMI_TAILWIND_CSS_PATH = '/tailwind.generated.css';
const NOMI_TAILWIND_CSS_FILE = resolve(__dirname, 'public', 'tailwind.generated.css');

function nomiStaticAssetPlugin(): Plugin {
  return {
    name: 'nomi-static-assets',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url === NOMI_TAILWIND_CSS_PATH) {
          fs.readFile(NOMI_TAILWIND_CSS_FILE, (error, css) => {
            if (error) {
              next();
              return;
            }
            res.statusCode = 200;
            res.setHeader('content-type', 'text/css; charset=utf-8');
            res.setHeader('cache-control', 'no-cache');
            res.end(css);
          });
          return;
        }
        next();
      });
    },
  };
}

// @imgly/background-removal 1.7.0 bundles ndarray's JIT-generated accessors and
// lodash's `Function("return this")()` into its browser build. Both are
// equivalent to small static helpers here, but violate the packaged renderer's
// strict `script-src 'self' wasm-unsafe-eval` policy. Transform only this
// dependency at build time so the application CSP does not need `unsafe-eval`.
function imglyCspSafePlugin(): Plugin {
  return {
    name: 'nomi-imgly-csp-safe',
    enforce: 'pre',
    transform(code) {
      const isImglyBundle =
        code.includes('var require_ndarray = __commonJS({') && code.includes('ndarray@1.0.19')
      if (!isImglyBundle) return null
      const start = code.indexOf('var require_ndarray = __commonJS({')
      const end = code.indexOf('// ../../node_modules/.pnpm/lodash-es@', start)
      if (start < 0 || end < 0) return null
      const safeNdarray = `var require_ndarray = __commonJS({
  "nomi-csp-safe-ndarray"(exports, module) {
    function defaultStride(shape) {
      const stride = new Array(shape.length)
      let size = 1
      for (let index = shape.length - 1; index >= 0; index -= 1) {
        stride[index] = size
        size *= shape[index]
      }
      return stride
    }
    function createView(data, shape, stride, offset) {
      const view = { data, shape, stride: stride || defaultStride(shape), offset: offset || 0 }
      view.dimension = view.shape.length
      view.size = view.shape.reduce((product, value) => product * value, 1)
      view.order = view.shape.map((_, index) => index)
      view.get = (...indices) => {
        let index = view.offset
        for (let dimension = 0; dimension < indices.length; dimension += 1) index += view.stride[dimension] * indices[dimension]
        return view.data[index]
      }
      view.set = (...args) => {
        const value = args.pop()
        let index = view.offset
        for (let dimension = 0; dimension < args.length; dimension += 1) index += view.stride[dimension] * args[dimension]
        view.data[index] = value
        return value
      }
      view.hi = (...limits) => createView(view.data, view.shape.map((value, index) => (typeof limits[index] === 'number' && limits[index] >= 0 ? limits[index] : value)), view.stride, view.offset)
      view.lo = (...starts) => {
        let nextOffset = view.offset
        const nextShape = view.shape.slice()
        for (let index = 0; index < starts.length; index += 1) {
          if (typeof starts[index] === 'number' && starts[index] >= 0) {
            nextOffset += view.stride[index] * starts[index]
            nextShape[index] -= starts[index]
          }
        }
        return createView(view.data, nextShape, view.stride, nextOffset)
      }
      view.step = (...steps) => createView(
        view.data,
        view.shape.map((value, index) => typeof steps[index] === 'number' ? Math.ceil(value / steps[index]) : value),
        view.stride.map((value, index) => value * (typeof steps[index] === 'number' ? steps[index] : 1)),
        view.offset,
      )
      view.transpose = (...axes) => {
        const resolved = view.shape.map((_, index) => (typeof axes[index] === 'number' ? axes[index] : index))
        return createView(view.data, resolved.map((index) => view.shape[index]), resolved.map((index) => view.stride[index]), view.offset)
      }
      view.pick = (...indices) => {
        let nextOffset = view.offset
        const nextShape = []
        const nextStride = []
        for (let index = 0; index < view.shape.length; index += 1) {
          const value = indices[index]
          if (typeof value === 'number' && value >= 0) nextOffset += view.stride[index] * value
          else {
            nextShape.push(view.shape[index])
            nextStride.push(view.stride[index])
          }
        }
        return createView(view.data, nextShape, nextStride, nextOffset)
      }
      return view
    }
    module.exports = (data, shape, stride, offset) => createView(data, shape || [data.length], stride, offset)
  }
});

`
      const transformed = `${code.slice(0, start)}${safeNdarray}${code.slice(end)}`.replace(
        'var root = freeGlobal_default || freeSelf || Function("return this")();',
        'var root = freeGlobal_default || freeSelf || globalThis;',
      )
      return { code: transformed, map: null }
    },
  }
}

function isKnownDevDependencyWarning(message: string): boolean {
  return (
    message.includes('The above dynamic import cannot be analyzed by Vite') &&
    message.includes('react-router-dom.js')
  );
}

function createNomiLogger(): Logger {
  const logger = createLogger();
  const warn = logger.warn.bind(logger);
  logger.warn = (message, options) => {
    if (typeof message === 'string' && isKnownDevDependencyWarning(message)) return;
    warn(message, options);
  };
  return logger;
}

function createManualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, '/');

  if (
    normalizedId.includes('vite/preload-helper') ||
    normalizedId.includes('commonjsHelpers') ||
    normalizedId.includes('/node_modules/@babel/runtime/helpers/') ||
    normalizedId.includes('/node_modules/@babel/helpers/') ||
    normalizedId.includes('/node_modules/tslib/')
  ) {
    return 'runtime-vendor';
  }
  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/') ||
    normalizedId.includes('/node_modules/use-sync-external-store/')
  ) {
    return 'react-vendor';
  }
  if (
    normalizedId.includes('/node_modules/zustand/') ||
    normalizedId.includes('/node_modules/immer/')
  ) {
    return 'state-vendor';
  }
  if (
    normalizedId.includes('/node_modules/clsx/') ||
    normalizedId.includes('/node_modules/tailwind-merge/')
  ) {
    return 'ui-vendor';
  }
  if (normalizedId.includes('/node_modules/@photo-sphere-viewer/core/')) {
    return 'panorama-vendor';
  }
  if (
    normalizedId.includes('/node_modules/prosemirror-') ||
    normalizedId.includes('/node_modules/orderedmap/') ||
    normalizedId.includes('/node_modules/w3c-keyname/')
  ) {
    return 'prosemirror-vendor';
  }
  if (
    normalizedId.includes('/node_modules/@tiptap/') ||
    normalizedId.includes('/node_modules/@prosemirror')
  ) {
    return 'tiptap-vendor';
  }
  if (
    normalizedId.includes('/node_modules/react-markdown/') ||
    normalizedId.includes('/node_modules/remark-') ||
    normalizedId.includes('/node_modules/rehype-') ||
    normalizedId.includes('/node_modules/unified/') ||
    normalizedId.includes('/node_modules/mdast-') ||
    normalizedId.includes('/node_modules/hast-')
  ) {
    return 'markdown-vendor';
  }
  if (normalizedId.includes('/node_modules/three/')) return 'three-vendor';
  if (
    normalizedId.includes('/node_modules/@react-three/') ||
    normalizedId.includes('/node_modules/three-stdlib/') ||
    normalizedId.includes('/node_modules/tunnel-rat/') ||
    normalizedId.includes('/node_modules/suspend-react/')
  ) {
    return 'r3f-vendor';
  }
  if (normalizedId.includes('/src/ui/stats/')) return 'app-stats';
  if (normalizedId.includes('/src/api/')) return 'app-api';
  return undefined;
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
  /^OnboardingFloatingPanel-/,
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

export default defineConfig(async ({ command, mode }) => {
  const react = (await import('@vitejs/plugin-react')).default;

  loadEnv(mode, process.cwd(), 'VITE_');

  if (command === 'build' && mode !== 'production') {
    throw new Error(
      `[nomi] Dev build is disabled. Use \`vite build --mode production\` (current mode: ${mode}).`,
    );
  }

  return {
    base: './',
    cacheDir: resolve(__dirname, '.tmp/vite'),
    customLogger: createNomiLogger(),
    plugins: [nomiStaticAssetPlugin(), imglyCspSafePlugin(), react()],
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
        '@react-three/drei',
        '@react-three/fiber',
        '@react-three/fiber > react-reconciler',
        '@react-three/fiber > react-reconciler/constants',
        '@tanstack/react-virtual',
        '@tiptap/core',
        '@tiptap/extension-placeholder',
        '@tiptap/react',
        '@tiptap/starter-kit',
        '@tiptap/suggestion',
        'clsx',
        'framer-motion',
        'i18next',
        'lucide-react',
        'react-i18next',
        'react-markdown',
        '@photo-sphere-viewer/core',
        'tailwind-merge',
        'swr',
        'three',
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
        resolveDependencies(_filename, deps) {
          return deps.filter((dep) => !shouldDeferModulePreload(dep));
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
      plugins: () => [imglyCspSafePlugin()],
    },
  };
});
