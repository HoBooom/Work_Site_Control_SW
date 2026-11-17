import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // digital-twin/fixtures, digital-twin/site-config, contracts/를 직접 읽는다
    fs: { allow: ['..'] },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
