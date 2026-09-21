#!/usr/bin/env node

import esbuild from "esbuild";

/**
 * @type {import("esbuild").BuildOptions}
 */
const base = {
  bundle: true,
  minify: false,
  outbase: `src`,
  outdir: `build`,
  packages: `external`,
  platform: `node`,
  target: `node20`,
  sourcemap: true,
};

/**
 * @type {import("esbuild").BuildOptions}
 */
const cjs = {
  ...base,
  format: `cjs`,
  outExtension: {
    ".js": `.cjs`,
  },
};

/**
 * @type {import("esbuild").BuildOptions}
 */
const esm = {
  ...base,
  format: `esm`,
  outExtension: {
    ".js": `.mjs`,
  },
};

// The CLI is ESM-only (yargs 18 has no CommonJS build); the library ships both.
await Promise.all([
  esbuild.build({
    ...esm,
    entryPoints: [`./src/index.ts`, `./src/cli.ts`],
  }),
  esbuild.build({
    ...cjs,
    entryPoints: [
      `./src/index.ts`,
      `./src/index.test.ts`,
      `./src/integration.test.ts`,
    ],
  }),
]);
