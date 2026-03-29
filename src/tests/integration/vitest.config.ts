import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    setupFiles: [path.resolve(__dirname, './setup.ts')],
    testTimeout: 10000,
    hookTimeout: 15000,
    sequence: {
      concurrent: false,   // run suites sequentially to avoid
    },                     // rate limit and DB state conflicts
    reporters: ['verbose'],
    env: {
      API_BASE_URL: process.env.TEST_API_BASE_URL 
        ?? process.env.API_BASE_URL 
        ?? 'http://localhost:3000',
    },
    alias: {
      '@': path.resolve(__dirname, '../../'),
    },
    include: [path.resolve(__dirname, '*.test.ts')],
  }
})
