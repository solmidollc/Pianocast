import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest config. We borrow the same React plugin Vite already uses so test
 * files can import from .tsx modules — the harmonic-analysis helpers
 * (analyzeFunctional, detectNeapolitan, …) live next to the React renderer
 * that consumes them and we'd rather test them in place than fork them.
 *
 * Test environment is "node" — none of the analysis code touches the DOM,
 * and pure-node runs are faster + immune to jsdom version skew.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
