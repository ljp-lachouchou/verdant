import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        '@agent': resolve('src/agent'),
        '@tools': resolve('src/tools'),
        '@storage': resolve('src/storage'),
        '@runtime': resolve('src/runtime')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        external: ['playwright', 'playwright-core', 'chromium-bidi']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
