const path = require('path');

module.exports = {
  extends: '../../.eslintrc.js', // Still extends the root .eslintrc.js
  ignorePatterns: ["dist", "build", "stories"],
  parserOptions: {
    project: [path.resolve(__dirname, './tsconfig.json')],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // Keep any specific rules or overrides for this package if necessary
    "@typescript-eslint/no-unsafe-enum-comparison": "warn",
    "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    "@typescript-eslint/no-unused-expressions": "warn",
    "@typescript-eslint/await-thenable": "warn",
    "no-constant-condition": "warn",
    "no-extra-semi": "warn",
    "no-prototype-builtins": "warn",
  },
  "plugins": ["react", "react-hooks", "jest", "testing-library"],
};
