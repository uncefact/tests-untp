const path = require('path');

module.exports = {
  extends: '../../.eslintrc.js', // Extend the root .eslintrc.js
  ignorePatterns: ["dist", "build"], // Keep ignorePatterns from the .json
  parserOptions: {
    project: [path.resolve(__dirname, './tsconfig.json')],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Keep any specific rules or overrides for this package if necessary
    "@typescript-eslint/no-base-to-string": "warn",
    "@typescript-eslint/prefer-promise-reject-errors": "warn",
    "@typescript-eslint/no-require-imports": "warn",
  },
};
