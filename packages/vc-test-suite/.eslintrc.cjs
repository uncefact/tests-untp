const path = require('path');

module.exports = {
  extends: '../../.eslintrc.js', // Still extends the root .eslintrc.js
  ignorePatterns: ["dist", "build", "__tests__"],
  parserOptions: {
    project: [path.resolve(__dirname, './tsconfig.json')],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Keep any specific rules or overrides for this package if necessary
    "@typescript-eslint/no-unused-expressions": "warn",

  },
};
