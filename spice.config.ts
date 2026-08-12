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

/** Copy the NewMM Thai dictionary used by the RTGS romanizer. */
const copyThaiWords = (): any => ({
  name: "vivid-lyrics-copy-thai-words",
  setup(build) {
    build.onEnd(() => {
      const src = resolve(projectRoot, "node_modules/nlpo3-newmm-typescript/dist/words_th.txt");
      const outDir = resolve(build.initialOptions.outdir ?? "./dist");
      mkdirSync(outDir, { recursive: true });
      if (existsSync(src)) copyFileSync(src, resolve(outDir, "words_th.txt"));
    });
  },
});

/** nlpo3-newmm-typescript pulls in node builtins for its default-dictionary
 *  loader, which we never use (we feed NewmmTokenizer.fromWordList the
 *  browser-fetched words file). Stub them so the bundle stays browser-safe. */
const nodeBuiltinShims = (): any => ({
  name: "vivid-lyrics-node-builtin-shims",
  setup(build) {
    const stub = (name: string) => ({
      loader: "js" as const,
      contents: `const throwNode = (api) => () => { throw new Error("${name} is node-only and not used in this bundle"); };
export const readFileSync = throwNode("readFileSync");
export const existsSync = throwNode("existsSync");
export const resolve = throwNode("resolve");
export const dirname = throwNode("dirname");
export const join = throwNode("join");
export const fileURLToPath = throwNode("fileURLToPath");
export const pathToFileURL = throwNode("pathToFileURL");
export const fs = { readFileSync, existsSync };
export const path = { resolve, dirname, join };
export const url = { fileURLToPath, pathToFileURL };
export default fs;`,
    });
    build.onResolve({ filter: /^(fs|path|url)$/ }, (args) => {
      if (args.importer.includes("nlpo3-newmm-typescript")) {
        return { path: args.path, namespace: "node-shim" };
      }
      return undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "node-shim" }, (args) => stub(args.path));
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
    plugins: [copyLinderaWasm(), copyThaiWords(), nodeBuiltinShims()],
    // The extension is injected into Spotify as a classic <script>, but the
    // Lindera wasm package emits `import.meta`, which is a parse-time
    // SyntaxError outside a module. Rewrite it to a plain object instead.
    supported: { "import-meta": false },
  },
});
