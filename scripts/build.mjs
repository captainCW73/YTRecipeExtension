import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" });
execFileSync("npx", ["esbuild", "src/contentScript.ts", "--bundle", "--format=iife", "--target=chrome116", "--outfile=dist/contentScript.js"], { stdio: "inherit" });
execFileSync("npx", ["esbuild", "src/background.ts", "--bundle", "--format=esm", "--target=chrome116", "--outfile=dist/background.js"], { stdio: "inherit" });
execFileSync("npx", ["esbuild", "src/sidepanel.ts", "--bundle", "--format=esm", "--target=chrome116", "--outfile=dist/sidepanel.js"], { stdio: "inherit" });
execFileSync("npx", ["esbuild", "src/popup.ts", "--bundle", "--format=esm", "--target=chrome116", "--outfile=dist/popup.js"], { stdio: "inherit" });
execFileSync("npx", ["esbuild", "src/debug.ts", "--bundle", "--format=esm", "--target=chrome116", "--outfile=dist/debug.js"], { stdio: "inherit" });

await cp("dist/contentScript.js", "contentScript.js");
await cp("dist/background.js", "background.js");
await cp("dist/sidepanel.js", "sidepanel.js");
await cp("dist/popup.js", "popup.js");
await cp("dist/debug.js", "debug.js");
await cp("manifest.json", "dist/manifest.json");
await cp("sidepanel.html", "dist/sidepanel.html");
await cp("sidepanel.css", "dist/sidepanel.css");
await cp("cooking.html", "dist/cooking.html");
await cp("cooking.css", "dist/cooking.css");
await cp("debug.html", "dist/debug.html");
await cp("popup.html", "dist/popup.html");
await cp("popup.css", "dist/popup.css");
