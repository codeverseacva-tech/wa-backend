import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest config for unit tests.
 * Unit tests run in-process so module mocking (vi.mock) works correctly.
 * No live Docker or API server is required.
 *
 * NOTE: Vitest is always invoked from the backend/ root (via npm run test:unit).
 * We anchor paths off process.cwd() which consistently resolves to backend/.
 */
const root = process.cwd(); // always backend/ when invoked via npm script
const unitDir = path.join(root, 'src', 'tests', 'unit').replace(/\\/g, '/');

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    testTimeout: 10000,
    reporters: ['verbose'],
    include: [`${unitDir}/*.test.ts`],
  },
});
