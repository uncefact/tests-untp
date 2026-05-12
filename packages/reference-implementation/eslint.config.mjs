import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'src/lib/prisma/generated',
      // e2e/ is a sibling workspace with its own tsconfig and Cypress-flavoured
      // conventions. It is not part of the RI's Next-flavoured lint surface.
      'e2e/**',
    ],
  },
];

export default eslintConfig;
