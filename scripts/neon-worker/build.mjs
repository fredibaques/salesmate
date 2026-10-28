// Bundles the worker (scripts/neon-worker/index.ts and the server code it
// uses) into dist/neon-worker/index.mjs and zips it for a Neon Functions
// deploy: `pnpm worker:build`.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { build } from "esbuild";

const out = "dist/neon-worker";
rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: ["scripts/neon-worker/index.ts"],
  outfile: `${out}/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // tsconfig.json's "@/…" paths resolve the app's modules.
  tsconfig: "tsconfig.json",
  // Bundled CommonJS dependencies (postgres, the Anthropic SDK…) still use require and __dirname.
  banner: {
    js: "import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

execFileSync("zip", ["-q", "-j", `${out}/function.zip`, `${out}/index.mjs`]);
console.log(`${out}/function.zip`);
