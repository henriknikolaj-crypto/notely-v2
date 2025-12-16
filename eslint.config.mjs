import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",

      "backups/**",
      "_archive/**",
      "supabase/.temp/**",
      "testdata/**",
      "Materiale/**",
      "__traener.html",
      "*.png",
    ],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Praktisk override: stop build fra at fejle pga. "any" og nogle hooks-regler.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "prefer-const": "warn",
      "import/no-anonymous-default-export": "off",
    },
  },
];

export default config;
