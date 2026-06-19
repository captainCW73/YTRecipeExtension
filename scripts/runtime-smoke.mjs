import { createServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const root = resolve(".");
const extensionPath = join(root, "dist");
const chromePath = await findChromeExecutable(join(root, ".context/browsers/chrome"));
const userDataDir = await mkdtemp(join(tmpdir(), "cooking-mode-chrome-"));
const certDir = await mkdtemp(join(tmpdir(), "cooking-mode-cert-"));
const keyPath = join(certDir, "key.pem");
const certPath = join(certDir, "cert.pem");
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes",
  "-keyout", keyPath,
  "-out", certPath,
  "-subj", "/CN=youtube.com",
  "-addext", "subjectAltName=DNS:youtube.com",
  "-days", "1"
], { stdio: "ignore" });
const server = createServer({
  key: await readFile(keyPath),
  cert: await readFile(certPath)
}, handleRequest);
const recipeServer = createHttpServer(handleRecipeRequest);

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;
await new Promise((resolveListen) => recipeServer.listen(0, "127.0.0.1", resolveListen));
const recipePort = recipeServer.address().port;

let browser;
let agentProcess;
try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    userDataDir,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      `--host-resolver-rules=MAP youtube.com 127.0.0.1:${port}`,
      "--ignore-certificate-errors",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=DialMediaRouteProvider"
    ]
  });

  const page = await browser.newPage();
  page.on("console", (message) => console.log(`[page:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
  await page.goto(`https://youtube.com:${port}/watch?v=runtime-steak`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#cooking-mode-youtube-button", { timeout: 10000 });
  const buttonText = await page.$eval("#cooking-mode-youtube-button", (node) => node.textContent);
  console.log(`[runtime] button=${buttonText?.trim()}`);
  assert(!/🍳/.test(buttonText || ""), "Button still uses emoji icon");
  await assertButtonVisible(page);
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().endsWith("/background.js"),
    { timeout: 10000 }
  );
  const worker = await workerTarget.worker();
  const extensionId = new URL(workerTarget.url()).hostname;
  await page.click("#cooking-mode-youtube-button");
  const state = await waitForRecipe(worker, page);
  const recipe = state.cookingMode?.recipe;
  assert(recipe, "No recipe stored after page button click");
  assert(recipe.source === "local-model", `Expected local-model source, got ${recipe.source}`);
  assert(recipe.ingredients.some((item) => /ribeye|steak/.test(item)), `Missing steak ingredient: ${recipe.ingredients.join(", ")}`);
  assert(recipe.ingredients.some((item) => /butter/.test(item)), `Missing butter: ${recipe.ingredients.join(", ")}`);
  assert(recipe.ingredients.some((item) => /garlic/.test(item)), `Missing garlic: ${recipe.ingredients.join(", ")}`);
  assert(recipe.instructions.some((step) => /sear/i.test(step)), `Missing sear step: ${recipe.instructions.join(" | ")}`);
  assert(recipe.instructions.some((step) => /rest/i.test(step)), `Missing rest step: ${recipe.instructions.join(" | ")}`);
  assert(recipe.modelConfidence >= 0.8, `Low confidence: ${recipe.modelConfidence}`);

  const panelPage = await browser.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
  await panelPage.waitForSelector("#recipe:not([hidden])", { timeout: 10000 });
  const rendered = await panelPage.evaluate(() => ({
    title: document.querySelector("#recipe-title")?.textContent || "",
    ingredients: Array.from(document.querySelectorAll("#ingredients li")).map((node) => node.textContent || ""),
    instructions: Array.from(document.querySelectorAll("#instructions li")).map((node) => node.textContent || "")
  }));
  assert(/Perfect Steak/i.test(rendered.title), `Panel did not render recipe title: ${rendered.title}`);
  assert(rendered.ingredients.some((item) => /ribeye|steak/i.test(item)), `Panel missing steak ingredient: ${rendered.ingredients.join(", ")}`);
  assert(rendered.instructions.some((item) => /sear/i.test(item)), `Panel missing sear instruction: ${rendered.instructions.join(" | ")}`);

  await worker.evaluate(async () => chrome.storage.session.clear());
  const titleOnlyPage = await browser.newPage();
  titleOnlyPage.on("console", (message) => console.log(`[title-only:${message.type()}] ${message.text()}`));
  await titleOnlyPage.goto(`https://youtube.com:${port}/watch?v=runtime-title-only`, { waitUntil: "domcontentloaded" });
  await titleOnlyPage.waitForSelector("#cooking-mode-youtube-button", { timeout: 10000 });
  await assertButtonVisible(titleOnlyPage);
  await titleOnlyPage.click("#cooking-mode-youtube-button");
  const titleOnlyState = await waitForRecipe(worker, titleOnlyPage);
  const titleOnlyRecipe = titleOnlyState.cookingMode?.recipe;
  assert(titleOnlyRecipe, "No title-only recipe stored after button click");
  assert(titleOnlyRecipe.source === "fallback", `Expected title-only fallback source, got ${titleOnlyRecipe.source}`);
  assert(titleOnlyRecipe.ingredients.length === 0, `Title-only invented ingredients: ${titleOnlyRecipe.ingredients.join(", ")}`);
  assert(titleOnlyRecipe.instructions.length === 0, `Title-only invented steps: ${titleOnlyRecipe.instructions.join(" | ")}`);
  assert(titleOnlyRecipe.modelConfidence <= 0.2, `Title-only high confidence: ${titleOnlyRecipe.modelConfidence}`);

  const genericPage = await browser.newPage();
  await genericPage.goto(`https://youtube.com:${port}/watch?v=runtime-generic`, { waitUntil: "domcontentloaded" });
  await genericPage.waitForSelector("#cooking-mode-youtube-button", { timeout: 10000 });
  await assertButtonVisible(genericPage);

  const shortsPage = await browser.newPage();
  await shortsPage.goto(`https://youtube.com:${port}/shorts/runtime-grilled-cheese`, { waitUntil: "domcontentloaded" });
  await shortsPage.waitForSelector("#cooking-mode-youtube-button", { timeout: 10000 });
  await assertShortsButtonAboveLike(shortsPage);

  const agentPort = await freePort();
  agentProcess = spawn(process.execPath, ["scripts/recipe-agent.mjs"], {
    cwd: root,
    env: { ...process.env, COOKING_MODE_AGENT_PORT: String(agentPort) },
    stdio: ["ignore", "ignore", "pipe"]
  });
  await waitForAgent(agentPort);
  await worker.evaluate(async (backendUrl) => {
    await chrome.storage.local.set({
      cookingModeAgentSettings: {
        enabled: true,
        backendUrl,
        model: "gpt-4o-mini"
      }
    });
  }, `http://127.0.0.1:${agentPort}`);

  await worker.evaluate(async () => chrome.storage.session.clear());
  const linkedRecipePage = await browser.newPage();
  await linkedRecipePage.goto(`https://youtube.com:${port}/watch?v=runtime-linked-cake`, { waitUntil: "domcontentloaded" });
  await linkedRecipePage.waitForSelector("#cooking-mode-youtube-button", { timeout: 10000 });
  await linkedRecipePage.click("#cooking-mode-youtube-button");
  const linkedState = await waitForRecipe(worker, linkedRecipePage);
  const linkedRecipe = linkedState.cookingMode?.recipe;
  assert(linkedRecipe, "No linked recipe stored after button click");
  assert(!/Linked Vanilla Cake/i.test(linkedRecipe.title), `Linked page was used as source: ${linkedRecipe.title}`);
  assert(linkedRecipe.source === "fallback", `Expected linked fallback source, got ${linkedRecipe.source}`);
  assert(!linkedRecipe.ingredients.some((item) => /flour/i.test(item)), `Linked page ingredient leaked in: ${linkedRecipe.ingredients.join(", ")}`);
  assert(!linkedRecipe.instructions.some((step) => /preheat/i.test(step)), `Linked page instruction leaked in: ${linkedRecipe.instructions.join(" | ")}`);

  console.log(JSON.stringify({
    ok: true,
    source: recipe.source,
    confidence: recipe.modelConfidence,
    renderedTitle: rendered.title,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions
  }, null, 2));
} finally {
  if (browser) await browser.close();
  if (agentProcess) agentProcess.kill();
  await new Promise((resolveClose) => server.close(resolveClose));
  await new Promise((resolveClose) => recipeServer.close(resolveClose));
  await rm(userDataDir, { recursive: true, force: true });
  await rm(certDir, { recursive: true, force: true });
}

async function waitForRecipe(worker, page) {
  const started = Date.now();
  let lastState = {};
  while (Date.now() - started < 12000) {
    const state = await worker.evaluate(async () => chrome.storage.session.get("cookingMode"));
    lastState = state;
    if (state.cookingMode?.recipe) return state;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const diagnostics = await page.evaluate(() => ({
    stage: document.documentElement.dataset.cookingModeStage || "none",
    source: document.documentElement.dataset.cookingModeRecipeSource || "none",
    items: document.documentElement.dataset.cookingModeRecipeItems || "none"
  })).catch(() => ({ stage: "unknown", source: "unknown", items: "unknown" }));
  throw new Error(`Timed out waiting for recipe in session storage, diagnostics=${JSON.stringify(diagnostics)}, state=${JSON.stringify(lastState)}`);
}

async function assertButtonVisible(page) {
  const visible = await page.$eval("#cooking-mode-youtube-button", (button) => {
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      opacity: style.opacity,
      visibility: style.visibility,
      display: style.display,
      color: style.color,
      background: style.backgroundColor,
      text: button.textContent
    };
  });
  assert(visible.width >= 60, `Button too narrow: ${JSON.stringify(visible)}`);
  assert(visible.height >= 30, `Button too short: ${JSON.stringify(visible)}`);
  assert(visible.opacity !== "0", `Button invisible opacity: ${JSON.stringify(visible)}`);
  assert(visible.visibility !== "hidden", `Button hidden: ${JSON.stringify(visible)}`);
  assert(visible.display !== "none", `Button display none: ${JSON.stringify(visible)}`);
  assert(/Cook/i.test(visible.text || ""), `Button text missing: ${JSON.stringify(visible)}`);
}

async function assertShortsButtonAboveLike(page) {
  const state = await page.$eval("#actions", (actions) => {
    const children = Array.from(actions.children);
    const buttonIndex = children.findIndex((child) => child.id === "cooking-mode-youtube-button");
    const likeIndex = children.findIndex((child) => {
      const text = `${child.getAttribute("aria-label") || ""} ${child.textContent || ""}`;
      return /\blike\b/i.test(text) && !/\bdislike\b/i.test(text);
    });
    const button = document.querySelector("#cooking-mode-youtube-button");
    const rect = button?.getBoundingClientRect();
    return {
      buttonIndex,
      likeIndex,
      width: rect?.width || 0,
      height: rect?.height || 0,
      text: button?.textContent || ""
    };
  });
  assert(state.buttonIndex !== -1, `Shorts button not in actions: ${JSON.stringify(state)}`);
  assert(state.likeIndex !== -1, `Shorts like action missing: ${JSON.stringify(state)}`);
  assert(state.buttonIndex < state.likeIndex, `Shorts button not above Like: ${JSON.stringify(state)}`);
  assert(state.width >= 40 && state.height >= 50, `Shorts button hidden: ${JSON.stringify(state)}`);
  assert(/Cook/i.test(state.text), `Shorts button text missing: ${JSON.stringify(state)}`);
}

function handleRequest(request, response) {
  const url = new URL(request.url || "/", `https://youtube.com:${port}`);
  console.log(`[server] ${url.pathname}`);
  if (url.pathname === "/api/timedtext") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      events: [
        { segs: [{ utf8: "Take ribeye steak salt pepper olive oil butter garlic and thyme. " }] },
        { segs: [{ utf8: "Season the steak. Sear it in a hot pan. " }] },
        { segs: [{ utf8: "Add butter garlic and thyme. Baste for two minutes. " }] },
        { segs: [{ utf8: "Rest before slicing." }] }
      ]
    }));
    return;
  }

  if (url.pathname.startsWith("/shorts/")) {
    const title = "The Best Grilled Cheese You'll Ever Make | Epicurious 101";
    const description = "Shorts cooking tutorial with captions.";
    const playerResponse = JSON.stringify({
      videoDetails: { shortDescription: description },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{
            baseUrl: `https://youtube.com:${port}/api/timedtext?lang=en`,
            languageCode: "en",
            name: { simpleText: "English" }
          }]
        }
      }
    });
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html>
<html>
  <head>
    <title>${title} - YouTube</title>
    <meta name="description" content="${description}" />
    <script>var ytInitialPlayerResponse = ${playerResponse};</script>
  </head>
  <body>
    <ytd-shorts>
      <ytd-reel-player-overlay-renderer>
        <h2>${title}</h2>
        <div id="actions">
          <div aria-label="Like this video"><button aria-label="Like this video">Like</button></div>
          <div aria-label="Dislike this video"><button aria-label="Dislike this video">Dislike</button></div>
          <div aria-label="Comments"><button aria-label="Comments">Comments</button></div>
        </div>
        <div id="description">${description}</div>
      </ytd-reel-player-overlay-renderer>
    </ytd-shorts>
  </body>
</html>`);
    return;
  }

  const videoId = url.searchParams.get("v") || "runtime-steak";
  const hasCaptions = videoId !== "runtime-title-only" && videoId !== "runtime-linked-cake" && videoId !== "runtime-generic";
  const title = videoId === "runtime-title-only"
    ? "How To Cook The Perfect Steak"
    : videoId === "runtime-linked-cake"
      ? "The Most AMAZING Vanilla Cake Recipe"
      : videoId === "runtime-generic"
        ? "Daily Studio Vlog"
        : "How to Cook the Perfect Steak";
  const description = videoId === "runtime-linked-cake"
    ? `Full written recipe: http://127.0.0.1:${recipePort}/linked-vanilla-cake-recipe`
    : hasCaptions ? "Cooking tutorial with captions." : "Cooking tutorial.";
  const playerResponse = JSON.stringify({
    videoDetails: { shortDescription: description },
    captions: hasCaptions
      ? {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{
              baseUrl: `https://youtube.com:${port}/api/timedtext?lang=en`,
              languageCode: "en",
              name: { simpleText: "English" }
            }]
          }
        }
      : undefined
  });

  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html>
<html>
  <head>
    <title>${title} - YouTube</title>
    <meta name="description" content="${description}" />
    <script>
      var ytInitialPlayerResponse = ${playerResponse};
    </script>
  </head>
  <body>
    <ytd-watch-flexy video-id="${videoId}">
      <ytd-watch-metadata>
        <h1 class="ytd-watch-metadata">${title}</h1>
        <div id="actions-inner">
          <div id="top-level-buttons-computed"></div>
        </div>
        <div id="description">${description}</div>
      </ytd-watch-metadata>
    </ytd-watch-flexy>
  </body>
</html>`);
}

function handleRecipeRequest(_request, response) {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Recipe",
        "name": "Linked Vanilla Cake",
        "description": "A linked vanilla cake recipe.",
        "prepTime": "PT25M",
        "cookTime": "PT30M",
        "recipeYield": "12 slices",
        "recipeIngredient": [
          "2 1/2 cups all-purpose flour",
          "2 tsp baking powder",
          "1/2 tsp salt",
          "1 1/2 cups sugar",
          "3 eggs",
          "1 cup milk"
        ],
        "recipeInstructions": [
          {"@type":"HowToStep","text":"Preheat the oven to 350F."},
          {"@type":"HowToStep","text":"Whisk the dry ingredients."},
          {"@type":"HowToStep","text":"Mix the batter."},
          {"@type":"HowToStep","text":"Bake until the cake springs back."}
        ]
      }
    </script>
  </head>
  <body>Linked recipe</body>
</html>`);
}

async function freePort() {
  const probe = createHttpServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const openPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return openPort;
}

async function waitForAgent(agentPort) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${agentPort}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("agent did not start");
}

async function findChromeExecutable(rootDir) {
  const entries = await walk(rootDir);
  const match = entries.find((entry) => entry.endsWith("/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
  if (!match) throw new Error("Chrome for Testing not found. Run: npx @puppeteer/browsers install chrome@stable --path .context/browsers");
  return match;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
