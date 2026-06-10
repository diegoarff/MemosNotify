import { defineConfig } from "tsdown";

// tsdown (oxc-based bundler) builds the single Node entrypoint to ESM in ./dist.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  // App, not a library — no .d.ts needed.
  dts: false,
});
