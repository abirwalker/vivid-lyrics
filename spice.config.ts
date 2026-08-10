import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@spicemod/creator";
import { ProjectName, ProjectVersion } from "./project/config";

/** `process` is typed by @types/bun in this repo; the config runs under the
 *  creator CLI where process.cwd() is the project root. */
const projectRoot = (process as unknown as { cwd: () => string }).cwd();

/** Copy the Lindera UniDic WASM next to the bundle so the dev server can
 *  serve it (`spicetify serve` / `@spicemod/creator` dev pipeline). */
const copyLinderaWasm = (): any => ({
  name: "vivid-lyrics-copy-lindera-wasm",
  setup(build) {
    build.onEnd(() => {
      const src = resolve(projectRoot, "node_modules/lindera-wasm-web-unidic/lindera_wasm_bg.wasm");
      const outDir = resolve(build.initialOptions.outdir ?? "./dist");
      mkdirSync(outDir, { recursive: true });
      if (existsSync(src)) copyFileSync(src, resolve(outDir, "lindera_wasm_bg.wasm"));
    });
  },
});

export default defineConfig({
  name: ProjectName,
  version: ProjectVersion,
  framework: "react",
  template: "extension",
  packageManager: "bun",
  cssId: "vivid-lyrics-styles",
  linter: "oxlint",
  esbuildOptions: {
    legalComments: "inline",
    plugins: [copyLinderaWasm()],
    // The extension is injected into Spotify as a classic <script>, but the
    // Lindera wasm package emits `import.meta`, which is a parse-time
    // SyntaxError outside a module. Rewrite it to a plain object instead.
    supported: { "import-meta": false },
  },
});
