const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function load(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(() => ({}), module, module.exports);
  return module.exports;
}

const { unpackLyrics } = load("src/lyrics/unpack.ts");
const { adaptLyrics } = load("src/lyrics/adapt.ts");

test("packed schema rows retain text, times, and alignment through adaptation", () => {
  const payload = [
    ["Type", "Line", "StartTime", "EndTime", "Content", "Text", "Vocal", "OppositeAligned", false, 1, 2, 3, "First", "Second"],
    [-1, 4, 0, 2, 3, 4, 1, 9, 11, -3, 2, 5, 0, 2, 3, 5, 7, 6, 9, 10, 12, 8, 6, 10, 11, 13, 8],
  ];
  const lyrics = adaptLyrics(unpackLyrics(payload));
  assert.equal(lyrics.type, "Line");
  assert.equal(lyrics.startTime, 1);
  assert.equal(lyrics.endTime, 3);
  assert.deepEqual(lyrics.content, [
    { Type: "Vocal", StartTime: 1, EndTime: 2, Text: "First", OppositeAligned: false },
    { Type: "Vocal", StartTime: 2, EndTime: 3, Text: "Second", OppositeAligned: false },
  ]);
});

test("ordinary arrays, singletons, empty containers, and primitive values", () => {
  assert.deepEqual(
    unpackLyrics([["word", true, null], [-2, 5, -6, -4, -5, 0, 1, 2]]),
    [{}, [], ["word"], true, null],
  );
  assert.deepEqual(unpackLyrics([[], [-3, 2, 0]]), [{}, {}]);
});

test("legacy objects pass through without changing their identity", () => {
  const lyrics = { Type: "Static", Lines: ["Original"] };
  assert.strictEqual(unpackLyrics(lyrics), lyrics);
  assert.equal(adaptLyrics(unpackLyrics(lyrics)).lines[0].text, "Original");
});

test("invalid payloads fail instead of producing partial lyrics", () => {
  for (const payload of [
    [], [[], [-7]], [[true], [2]], [["x"], [-1, 1, 0]],
    [["__proto__"], [-1, 1, 0, -6]], [[], [-4, 0]],
    [[], [-2, 999999999]], [[{}], [0]], [[], [-3, 2 ** 20, 2 ** 16]],
    [["x"], Array(514).fill(-5).concat(0)],
  ]) {
    assert.throws(() => unpackLyrics(payload));
  }
});
