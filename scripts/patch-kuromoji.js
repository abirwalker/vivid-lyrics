/**
 * Patches kuromoji's DictionaryLoader to replace require("path") with an
 * inline joinPath so the bundle works in the browser (no Node "path" module).
 */
const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "kuromoji",
  "src",
  "loader",
  "DictionaryLoader.js"
);

if (!fs.existsSync(target)) {
  console.log("[postinstall] kuromoji DictionaryLoader.js not found, skipping patch");
  process.exit(0);
}

let src = fs.readFileSync(target, "utf8");

if (src.includes('var path = require("path")')) {
  src = src.replace(
    'var path = require("path");',
    'function joinPath(a, b) { return a.replace(/\\/+$/, "") + "/" + b; }'
  );
}

// Replace ALL forms of path.join(dic_path, ...)
src = src.replace(/path\.join\(dic_path,\s*/g, "joinPath(dic_path, ");

fs.writeFileSync(target, src, "utf8");
console.log("[postinstall] Patched kuromoji DictionaryLoader.js (removed path require)");
