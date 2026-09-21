import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import prettierPlugin from "eslint-plugin-prettier";
import sortDestructureKeys from "eslint-plugin-sort-destructure-keys";
import sortKeysFix from "eslint-plugin-sort-keys-fix";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [`build/**`, `node_modules/**`, `tmp/**`] },
  ...tseslint.configs.strictTypeChecked,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  eslintConfigPrettier,
  {
    files: [`src/**/*.ts`],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier: prettierPlugin,
      "sort-destructure-keys": sortDestructureKeys,
      "sort-keys-fix": sortKeysFix,
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": [1, `type`],
      "@typescript-eslint/consistent-type-exports": 1,
      "@typescript-eslint/consistent-type-imports": 1,
      "@typescript-eslint/explicit-function-return-type": [
        1,
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/naming-convention": [
        2,
        {
          format: [`strictCamelCase`, `UPPER_CASE`, `PascalCase`, `snake_case`],
          leadingUnderscore: `allow`,
          selector: `variableLike`,
        },
      ],
      "@typescript-eslint/no-unused-vars": [1, { argsIgnorePattern: `^_` }],
      "@typescript-eslint/restrict-template-expressions": [
        2,
        { allowNumber: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": 2,
      "import/order": [
        1,
        {
          groups: [`builtin`, `external`, `internal`, `parent`, `sibling`, `index`],
          "newlines-between": `always`,
        },
      ],
      "no-useless-rename": 1,
      "object-shorthand": [1, `always`],
      "prettier/prettier": [
        1,
        { endOfLine: `auto`, quoteProps: `consistent`, trailingComma: `all` },
      ],
      "quotes": [1, `backtick`],
      "sort-destructure-keys/sort-destructure-keys": 2,
      "sort-keys-fix/sort-keys-fix": [2, `asc`, { natural: true }],
    },
    settings: {
      "import/resolver": { typescript: true },
    },
  },
);
