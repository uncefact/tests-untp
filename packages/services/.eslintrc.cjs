const path = require('path');

module.exports = {
  extends: '../../.eslintrc.js', // Still extends the root .eslintrc.js
  ignorePatterns: ["dist", "build"],
  parserOptions: {
    project: [path.resolve(__dirname, './tsconfig.json')],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Keep any specific rules or overrides for this package if necessary
    "@typescript-eslint/prefer-promise-reject-errors": "warn"
  },
};
