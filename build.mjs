/**
 * Build both halves of Dice Bridge with esbuild:
 *   dist/extension  – Manifest V3 extension, load-unpacked ready
 *   dist/companion  – Owlbear Rodeo extension to host on any static site
 *
 * Usage: node build.mjs [--watch]
 */
import { build, context } from "esbuild";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const watch = process.argv.includes("--watch");
const root = path.dirname(new URL(import.meta.url).pathname);

const shared = {
  bundle: true,
  format: "iife",
  target: ["chrome110"],
  platform: "browser",
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
};

const extension = {
  ...shared,
  entryPoints: [
    "src/extension/background.js",
    "src/extension/content-source.js",
    "src/extension/content-bridge.js",
    "src/extension/popup.js",
    "src/extension/options.js",
  ],
  outdir: "dist/extension",
  outbase: "src/extension",
};

const companion = {
  ...shared,
  entryPoints: ["src/companion/page.js"],
  outdir: "dist/companion",
  outbase: "src/companion",
};

const staticFiles = [
  ["src/extension/manifest.json", "dist/extension"],
  ["src/extension/popup.html", "dist/extension"],
  ["src/extension/popup.css", "dist/extension"],
  ["src/extension/options.html", "dist/extension"],
  ["src/extension/options.css", "dist/extension"],
  ["src/companion/index.html", "dist/companion"],
  ["src/companion/background.html", "dist/companion"],
  ["src/companion/manifest.json", "dist/companion"],
  ["src/companion/icon.svg", "dist/companion"],
];

async function copyStatic() {
  await mkdir("dist/extension", { recursive: true });
  await mkdir("dist/companion", { recursive: true });
  for (const [from, to] of staticFiles) {
    await cp(path.join(root, from), path.join(root, to, path.basename(from)));
  }
}

async function main() {
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  await copyStatic();

  if (watch) {
    const contexts = await Promise.all([context(extension), context(companion)]);
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching src/ … reload the extension and refresh the room after changes.");
    return;
  }

  await Promise.all([build(extension), build(companion)]);
  const files = await readdir(path.join(root, "dist/extension"));
  console.log(`\nExtension ready: dist/extension (${files.length} files)`);
  console.log("Companion ready: dist/companion (host this folder over HTTPS)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
