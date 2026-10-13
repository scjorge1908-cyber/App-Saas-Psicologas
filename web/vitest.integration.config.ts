import { defineConfig } from 'vitest/config';

// Testes de integração: supabase-js real contra o gateway local (dev-gateway).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    fileParallelism: false,
  },
});
