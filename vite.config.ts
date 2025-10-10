import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'UnrestrictedPostgresMCP',
      fileName: 'index',
      formats: ['es']
    },
    rollupOptions: {
      external: [
        '@modelcontextprotocol/sdk',
        'express',
        'pg',
        'zod',
        'node:process',
        'node:crypto',
        'node:buffer',
        'node:async_hooks',
        'node:string_decoder',
        'async_hooks',
        'buffer',
        'string_decoder'
      ],
      output: {
        entryFileNames: 'index.js'
      }
    },
    target: 'node18',
    minify: false,
    sourcemap: true
  },
  resolve: {
    alias: {
      '#src': resolve(__dirname, 'src'),
      '#lib': resolve(__dirname, 'src/lib')
    }
  },
  esbuild: {
    target: 'node18'
  },
  define: {
    global: 'globalThis'
  }
})