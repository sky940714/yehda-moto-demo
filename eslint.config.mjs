import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Product and catalog images use administrator-provided R2 URLs at runtime.
      '@next/next/no-img-element': 'off',
    },
  },
  {
    files: ['app/page.tsx'],
    rules: {
      // This file still contains dormant prototype screens kept for a later visual migration.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
