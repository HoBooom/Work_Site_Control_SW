import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // digital-twin/fixtures, digital-twin/site-config, contracts/를 직접 읽는다
    fs: { allow: ['..'] },
    // 영상·멈춘 프레임은 서버(지금은 Mock 서버 tools/mock-server.mjs, 8090)가 준다
    proxy: {
      '/stream': 'http://localhost:8090',
      '/frames': 'http://localhost:8090',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
