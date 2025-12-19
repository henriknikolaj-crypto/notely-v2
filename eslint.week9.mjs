import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  js.configs.recommended,
  { ignores: [".next/**", "node_modules/**"] },
  {
    files: ["app/exam/**/*.{ts,tsx,js,jsx}"],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: "latest", sourceType: "module" } },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-undef": "off",
      "no-empty": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off"
    }
  }
];
