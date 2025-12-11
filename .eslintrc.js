const path = require('path');

module.exports = {
  root: true,
  ignorePatterns: [
    "documentation",
    "e2e",
    "packages/mock-app/**",
    "packages/untp-playground/.eslintrc.js"
  ],
  plugins: [
    "@typescript-eslint",
    "prettier"
  ],
  parser: "@typescript-eslint/parser",
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  parserOptions: {
    project: [
      path.resolve(__dirname, "./packages/*/tsconfig.json"),
      path.resolve(__dirname, "./initialisation/tsconfig.json")
    ],
    tsconfigRootDir: __dirname,
  },
  rules: {
    "no-console": "warn",
    "prefer-rest-params": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-var-requires": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/restrict-template-expressions": "off",
    "@typescript-eslint/no-misused-promises": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "prefer-const": "off",
    "@typescript-eslint/no-redundant-type-constituents": "off"
  },
  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.test.tsx"],
      "rules": {
        "@typescript-eslint/unbound-method": "off"
      }
    },
    {
      "files": [
        "*.js"
      ],
      "rules": {
        "@typescript-eslint/no-var-requires": "off"
      }
    },
    {
      "files": [
        "**/next-env.d.ts"
      ],
      "rules": {
        "@typescript-eslint/triple-slash-reference": "off"
      }
    }
  ]
};