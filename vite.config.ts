import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

function createManualChunks(id: string): string | undefined {
  if (
    id.includes('/node_modules/prosemirror-') ||
    id.includes('/node_modules/orderedmap/') ||
    id.includes('/node_modules/w3c-keyname/')
  ) {
    return 'prosemirror-vendor';
  }
  if (
    id.includes('/node_modules/@tiptap/') ||
    id.includes('/node_modules/@prosemirror')
  ) {
    return 'tiptap-vendor';
  }
  if (
    id.includes('/node_modules/react-markdown/') ||
    id.includes('/node_modules/remark-') ||
    id.includes('/node_modules/rehype-') ||
    id.includes('/node_modules/unified/') ||
    id.includes('/node_modules/mdast-') ||
    id.includes('/node_modules/hast-')
  ) {
    return 'markdown-vendor';
  }
  if (id.includes('/node_modules/three/')) return 'three-vendor';
  if (
    id.includes('/node_modules/@react-three/') ||
    id.includes('/node_modules/three-stdlib/') ||
    id.includes('/node_modules/tunnel-rat/') ||
    id.includes('/node_modules/suspend-react/')
  ) {
    return 'r3f-vendor';
  }
  if (id.includes('/src/ui/stats/')) return 'app-stats';
  if (id.includes('/src/api/')) return 'app-api';
  return undefined;
}

export default defineConfig(({ command, mode }) => {
  loadEnv(mode, process.cwd(), 'VITE_');

  if (command === 'build' && mode !== 'production') {
    throw new Error(
      `[nomi] Dev build is disabled. Use \`vite build --mode production\` (current mode: ${mode}).`,
    );
  }

  return {
    base: './',
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      fs: {
        allow: [resolve(__dirname)],
      },
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
  };
});
