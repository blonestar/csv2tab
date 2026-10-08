import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// verzija i autor iz package.json → %VITE_APP_VERSION% / %VITE_APP_AUTHOR% u index.html
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
process.env.VITE_APP_VERSION = pkg.version;
process.env.VITE_APP_AUTHOR = pkg.author;

export default defineConfig({
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
