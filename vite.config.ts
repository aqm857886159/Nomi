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
  if (normalizedId.includes('/node_modules/react-pannellum/')) {
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
    plugins: [nomiStaticAssetPlugin(), react()],
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
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      hmr: process.env.NOMI_DISABLE_VITE_HMR === '1' ? false : undefined,
      fs: {
        allow: [resolve(__dirname)],
      },
    },
    optimizeDeps: {
      entries: ['index.html', 'src/dev/optimizeDepsEntry.ts'],
      force: command === 'serve',
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
        'react-markdown',
        'react-pannellum',
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
    },
  };
});
