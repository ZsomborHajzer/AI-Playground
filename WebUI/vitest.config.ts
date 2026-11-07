import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: [
      // The marketplace's dependency-free shared code (manifest, validator, signatures).
      {
        find: '@marketplace-shared',
        replacement: path.resolve(__dirname, '../marketplace-server/shared/index.ts'),
      },
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // Only the `electron/` prefix — a bare `electron` must stay the npm package.
      { find: /^electron\//, replacement: `${path.resolve(__dirname, './electron')}/` },
    ],
  },
})
