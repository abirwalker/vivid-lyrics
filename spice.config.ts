import { defineConfig } from "@spicemod/creator";
import { ProjectName, ProjectVersion } from "./project/config";

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
  },
});
