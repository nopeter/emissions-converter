import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  test: {
    // The engine must be testable without a browser.
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
