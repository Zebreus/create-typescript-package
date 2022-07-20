const common = {
    extends: ["eslint:recommended"],
    plugins: ["import"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": ["off", { ignoreRestSiblings: true }],
  
      // Import styling
      "import/first": "error",
      "import/no-duplicates": ["error", { considerQueryString: true }],
      "import/no-namespace": "error",
      "import/extensions": ["error", "always", { js: "never", jsx: "never", ts: "never", tsx: "never" }],
      "import/order": [
        "error",
        {
          groups: [
            ["internal", "external", "builtin"],
            ["parent", "sibling", "index"],
          ],
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/newline-after-import": "error",
      "import/no-anonymous-default-export": "error",
  
      //Static import analysis
      "import/no-unresolved": "error",
      "import/named": "error",
      "import/default": "error",
      "import/namespace": "error",
      "import/no-dynamic-require": "error",
      "import/no-self-import": "error",
      "import/no-useless-path-segments": ["error", { noUselessIndex: true }],
      "import/no-relative-packages": "error",
  
      "import/export": "error",
      "import/no-unused-modules": "error",
      "import/no-deprecated": "error",
      "import/no-named-as-default-member": "warn",
    },
  }
  
  module.exports = {
    env: {
      browser: true,
      node: true,
      es6: true,
    },
    overrides: [
      {
        files: ["*.ts", "*.tsx"],
        extends: [
          ...common.extends,
          "plugin:@typescript-eslint/eslint-recommended",
          "plugin:@typescript-eslint/recommended",
        ],
        plugins: [...common.plugins, "@typescript-eslint"],
        rules: {
          "@typescript-eslint/explicit-module-boundary-types": "off",
          "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
          "@typescript-eslint/switch-exhaustiveness-check": "error",
          "@typescript-eslint/no-empty-function": "off",
          ...common.rules,
          "import/named": "off",
        },
        parserOptions: {
          parser: "@typescript-eslint/parser",
          ecmaVersion: 2018,
          sourceType: "module",
          project: "./tsconfig.json",
        },
        settings: {
          "import/external-module-folders": ["node_modules", "node_modules/@types"],
          "import/parsers": {
            "@typescript-eslint/parser": [".ts", ".tsx"],
          },
          "import/resolver": {
            node: {
              extensions: [],
            },
          },
        },
      },
      {
        files: ["*.js", "*.jsx"],
        ...common,
      },
    ],
  }
  