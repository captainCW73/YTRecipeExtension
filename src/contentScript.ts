import { analyzeRecipeVideo } from "./recipeParser";
import { extractWithLocalRecipeModel } from "./localRecipeModel";
import type { ActionResult, ContentOpenResult, ContentStatus, RecipePayload, RuntimeMessage, WakeLockMode } from "./types";

const buttonId = "cooking-mode-youtube-button";
const styleId = "cooking-mode-youtube-style";
const loadedKey = "__cookingModeYouTubeLoaded";
const storageKey = "cookingMode";
let currentUrl = location.href;
let wakeLock: WakeLockSentinel | null = null;
let lastRecipe: RecipePayload | null = null;
let renderAttempts = 0;
let watchdogTimer: number | undefined;
let wakeLockMode: WakeLockMode = "video";
let wakeLockTimer: number | undefined;

const globalWindow = window as Window & { [loadedKey]?: boolean };
if (!globalWindow[loadedKey]) {
  globalWindow[loadedKey] = true;
  init();
}

function init(): void {
  observePage();
  window.addEventListener("yt-navigate-finish", handleNavigation);
  window.addEventListener("yt-page-data-updated", scheduleRender);
  window.addEventListener("popstate", handleNavigation);
  window.addEventListener("pageshow", scheduleRender);
  window.addEventListener("focus", scheduleRender);
  window.addEventListener("beforeunload", releaseWakeLock);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  chrome.runtime.onMessage.addListener(handleMessage);
  startWatchdog();
  notifyReady();
  scheduleRender();
}

function observePage(): void {
  const observer = new MutationObserver(() => {
    if (location.href !== currentUrl) handleNavigation();
    scheduleRender();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function handleNavigation(): void {
  currentUrl = location.href;
  lastRecipe = null;
  renderAttempts = 0;
  releaseWakeLock();
  document.getElementById(buttonId)?.remove();
  notifyReady();
  scheduleRender();
}

let renderTimer: number | undefined;
function scheduleRender(): void {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderButton, 350);
}

function renderButton(): void {
  renderButtonWithMode(false);
}

function renderButtonWithMode(force: boolean): void {
  if (!force && !isYouTubePage()) return;
  if (!force && !isVideoPage()) {
    document.getElementById(buttonId)?.remove();
    retryRender();
    return;
  }
  const existingButton = document.getElementById(buttonId) as HTMLButtonElement | null;
  if (existingButton) {
    if (isShortsPage()) placeShortsButton(existingButton);
    else placeWatchButton(existingButton);
    return;
  }

  const description = readDescription();
  const title = readTitle();
  const analysis = analyzeRecipeVideo(title, description);
  const likelyCooking = analysis.likely;
  if (!title && !description) retryRender();

  injectStyle();
  const button = createCookingButton(likelyCooking);
  const placed = isShortsPage() ? placeShortsButton(button) : placeWatchButton(button);
  if (!placed) placeFloatingButton(button);
}

function createCookingButton(likelyCooking: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = buttonId;
  button.type = "button";
  button.title = "Extract this recipe and keep screen awake";
  button.setAttribute("aria-label", "Cooking Mode");
  button.dataset.confidence = likelyCooking ? "recipe" : "scan";
  button.className = isShortsPage() ? "cooking-mode-youtube-shorts-button" : "cooking-mode-youtube-watch-button";
  button.innerHTML = isShortsPage()
    ? `${recipeIconSvg()}<span class="cooking-mode-shorts-label">Cook</span>`
    : `${recipeIconSvg()}<span class="cooking-mode-label">Cook</span>`;
  button.addEventListener("pointerdown", stopYouTubeEvent, true);
  button.addEventListener("mousedown", stopYouTubeEvent, true);
  button.addEventListener("click", handleCookingButtonClick, true);
  return button;
}

function recipeIconSvg(): string {
  return `<span class="cooking-mode-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M6.5 10.25A5.5 5.5 0 0 1 12 5a5.5 5.5 0 0 1 5.5 5.25h.75a2.75 2.75 0 0 1 0 5.5H5.75a2.75 2.75 0 0 1 0-5.5h.75Zm0 2H5.75a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H17.5a2 2 0 0 1-2-2A3.5 3.5 0 0 0 12 7a3.5 3.5 0 0 0-3.5 3.25 2 2 0 0 1-2 2ZM7 18h10a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2Z"></path></svg></span>`;
}

function stopYouTubeEvent(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.dataset.busy = String(busy);
  const label = button.querySelector<HTMLElement>(".cooking-mode-label, .cooking-mode-shorts-label");
  if (label) label.textContent = busy ? "Opening" : "Cook";
}

async function handleCookingButtonClick(event: MouseEvent): Promise<void> {
  stopYouTubeEvent(event);
  const button = event.currentTarget as HTMLButtonElement;
  setButtonBusy(button, true);
  try {
    await openPanelFromContent();
    await openCookingMode();
  } finally {
    window.setTimeout(() => setButtonBusy(button, false), 900);
  }
}

function placeWatchButton(button: HTMLButtonElement): boolean {
  const host = findFirstElement([
    "ytd-watch-metadata ytd-menu-renderer #top-level-buttons-computed",
    "ytd-watch-metadata #actions-inner #top-level-buttons-computed",
    "#above-the-fold #top-level-buttons-computed",
    "#menu-container #top-level-buttons-computed",
    "ytd-menu-renderer #top-level-buttons-computed",
    "#top-level-buttons-computed",
    "ytd-watch-metadata #actions-inner",
    "ytd-watch-metadata #actions"
  ]);
  if (!host) return false;
  const likeButton = host.querySelector<HTMLElement>(
    "ytd-segmented-like-dislike-button-renderer, like-button-view-model, segmented-like-dislike-button-view-model, ytd-toggle-button-renderer"
  );
  if (likeButton) host.insertBefore(button, likeButton);
  else host.prepend(button);
  return true;
}

function placeFloatingButton(button: HTMLButtonElement): boolean {
  button.classList.add("cooking-mode-youtube-floating-button");
  document.body.append(button);
  return true;
}

function placeShortsButton(button: HTMLButtonElement): boolean {
  const actions = findFirstElement([
    "ytd-reel-player-overlay-renderer #actions",
    "ytd-shorts ytd-reel-player-overlay-renderer #actions",
    "ytd-reel-video-renderer #actions",
    "[is-shorts] #actions"
  ]);
  if (!actions) return false;
  const likeAction = findShortsLikeAction(actions);
  if (likeAction && likeAction !== button) actions.insertBefore(button, likeAction);
  else actions.prepend(button);
  return true;
}

function findShortsLikeAction(actions: HTMLElement): HTMLElement | null {
  const candidates = Array.from(actions.querySelectorAll<HTMLElement>(
    "button, ytd-toggle-button-renderer, ytd-button-renderer, yt-button-shape, .yt-spec-button-shape-next, [aria-label]"
  ));

  for (const candidate of candidates) {
    const text = getNodeLabel(candidate);
    if (!/\blike\b/i.test(text) || /\bdislike\b/i.test(text)) continue;
    const item = directChildOf(actions, candidate);
    if (item && item.id !== buttonId) return item;
  }

  return Array.from(actions.children).find((child) => {
    const text = getNodeLabel(child as HTMLElement);
    return /\blike\b/i.test(text) && !/\bdislike\b/i.test(text);
  }) as HTMLElement | undefined || null;
}

function directChildOf(parent: HTMLElement, node: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = node;
  while (current && current.parentElement !== parent) {
    current = current.parentElement;
  }
  return current?.parentElement === parent ? current : null;
}

async function openCookingMode(): Promise<void> {
  setStage("extracting");
  const { recipe, wakeLockActive } = await prepareCookingMode();
  document.documentElement.dataset.cookingModeRecipeSource = recipe?.source || "missing";
  document.documentElement.dataset.cookingModeRecipeItems = String((recipe?.ingredients?.length || 0) + (recipe?.instructions?.length || 0));
  setStage("storing");
  await withTimeout(setStoredCookingMode({ recipe, wakeLockActive }), 1500, undefined).catch(() => undefined);
  const message: RuntimeMessage = { type: "OPEN_COOKING_MODE", recipe, wakeLockActive };
  setStage("sending");
  await withTimeout(chrome.runtime.sendMessage(message), 1200, undefined).catch(() => undefined);
  setStage("done");
}

function setStoredCookingMode(value: { recipe: RecipePayload; wakeLockActive: boolean }): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [storageKey]: value }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function openPanelFromContent(): Promise<ActionResult | undefined> {
  const message: RuntimeMessage = { type: "OPEN_PANEL_FROM_CONTENT" };
  return chrome.runtime.sendMessage(message).catch(() => undefined) as Promise<ActionResult | undefined>;
}

async function prepareCookingMode(): Promise<{ recipe: RecipePayload; wakeLockActive: boolean }> {
  await expandDescription();
  const description = await waitForText(readDescription, 900) || readDescription();
  const title = readTitle();
  const recipe = await buildBestRecipe(title, location.href, description);
  lastRecipe = recipe;
  wakeLockMode = await getStoredWakeLockMode();
  const wakeLockActive = await withTimeout(requestWakeLock(), 800, false);
  applyWakeLockMode(wakeLockMode);
  return { recipe, wakeLockActive };
}

function getStoredWakeLockMode(): Promise<WakeLockMode> {
  return new Promise((resolve) => {
    chrome.storage.session.get<{ cookingMode?: { wakeLockMode?: WakeLockMode } }>(storageKey, (state) => {
      void chrome.runtime.lastError;
      resolve(state?.cookingMode?.wakeLockMode || "video");
    });
  });
}

async function buildBestRecipe(title: string, url: string, description: string): Promise<RecipePayload> {
  const transcript = await fetchTranscript() || await fetchTranscriptFromPage();
  const agentRecipe = await askRecipeAgent(title, url, description, transcript);
  if (agentRecipe) return agentRecipe;
  return extractWithLocalRecipeModel(title, url, description, transcript);
}

async function askRecipeAgent(title: string, url: string, description: string, transcript: string): Promise<RecipePayload | undefined> {
  const message: RuntimeMessage = {
    type: "EXTRACT_WITH_AGENT",
    request: { title, url, description, transcript }
  };
  const result = await withTimeout(chrome.runtime.sendMessage(message), 12000, undefined).catch(() => undefined) as ActionResult | undefined;
  return result?.ok ? result.recipe : undefined;
}

function findFirstElement(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) return node;
  }
  return null;
}

function getNodeLabel(node: HTMLElement): string {
  return [
    node.getAttribute("aria-label"),
    node.getAttribute("title"),
    node.textContent
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function isYouTubePage(): boolean {
  return location.hostname === "youtube.com" || location.hostname.endsWith(".youtube.com");
}

function isVideoPage(): boolean {
  if (location.pathname === "/watch" && new URLSearchParams(location.search).has("v")) return true;
  if (location.pathname.startsWith("/shorts/")) return true;
  if (location.pathname.startsWith("/embed/")) return true;
  return Boolean(document.querySelector("ytd-watch-flexy[video-id], ytd-watch-metadata h1, ytd-reel-video-renderer"));
}

function isShortsPage(): boolean {
  return location.pathname.startsWith("/shorts/");
}

function readTitle(): string {
  return document.querySelector<HTMLHeadingElement>("h1.ytd-watch-metadata")?.innerText.trim()
    || document.querySelector<HTMLElement>("h1 yt-formatted-string")?.innerText.trim()
    || document.querySelector<HTMLElement>("#title h1")?.innerText.trim()
    || document.querySelector<HTMLElement>("ytd-reel-video-renderer h2")?.innerText.trim()
    || document.querySelector<HTMLElement>("[aria-label='Title']")?.textContent?.trim()
    || readMeta("title")
    || readMeta("og:title")
    || readMeta("twitter:title")
    || document.title.replace(/ - YouTube$/, "").trim();
}

function readDescription(): string {
  const selectors = [
    "ytd-watch-metadata #description-inner",
    "ytd-text-inline-expander #expanded",
    "ytd-text-inline-expander",
    "ytd-reel-video-renderer #description",
    "ytd-reel-player-overlay-renderer",
    "ytm-video-description",
    "#description-inline-expander yt-attributed-string",
    "#description-inline-expander",
    "#structured-description",
    "#description",
    "#bottom-row"
  ];
  for (const selector of selectors) {
    const text = document.querySelector<HTMLElement>(selector)?.innerText.trim();
    if (text && text.length > 10) return text;
  }
  return readMeta("description")
    || readMeta("og:description")
    || readMeta("twitter:description")
    || readInitialPlayerDescription()
    || "";
}

function readMeta(name: string): string {
  return document.querySelector<HTMLMetaElement>(`meta[name="${cssEscape(name)}"], meta[property="${cssEscape(name)}"]`)?.content?.trim() || "";
}

function readInitialPlayerDescription(): string {
  return readInitialPlayerResponse()?.videoDetails?.shortDescription || "";
}

async function fetchTranscript(): Promise<string> {
  const captionTracks = readCaptionTracks();
  if (!captionTracks.length) return "";
  const track = chooseCaptionTrack(captionTracks);
  if (!track?.baseUrl) return "";

  try {
    const url = addFormatToCaptionUrl(track.baseUrl);
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return "";
    const text = await response.text();
    return parseCaptionResponse(text);
  } catch {
    return "";
  }
}

async function fetchTranscriptFromPage(): Promise<string> {
  const visibleTranscript = readTranscriptFromDom();
  if (visibleTranscript) return visibleTranscript;

  await openTranscriptPanel();
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  return readTranscriptFromDom();
}

async function openTranscriptPanel(): Promise<void> {
  const directButton = findClickableByText(/\b(show transcript|transcript)\b/i);
  if (directButton) {
    directButton.click();
    return;
  }

  const menuButton = findFirstElement([
    "ytd-watch-metadata button[aria-label*='More actions' i]",
    "ytd-menu-renderer button[aria-label*='More actions' i]",
    "#actions button[aria-label*='More actions' i]",
    "button[aria-label*='More' i]"
  ]);
  menuButton?.click();
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  findClickableByText(/\b(show transcript|transcript)\b/i)?.click();
}

function findClickableByText(pattern: RegExp): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(
    "button, tp-yt-paper-button, tp-yt-paper-item, ytd-menu-service-item-renderer, ytd-button-renderer, [role='button'], [role='menuitem']"
  ));
  return nodes.find((node) => {
    if (node.id === buttonId || node.closest(`#${buttonId}`)) return false;
    const text = getNodeLabel(node);
    return pattern.test(text);
  }) || null;
}

function readTranscriptFromDom(): string {
  const transcriptRoot = findFirstElement([
    "ytd-transcript-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript']",
    "#engagement-panel-searchable-transcript",
    "[class*='transcript']"
  ]);
  if (!transcriptRoot) return "";

  const segmentNodes = Array.from(transcriptRoot.querySelectorAll<HTMLElement>(
    "ytd-transcript-segment-renderer, yt-formatted-string.segment-text, .segment-text, [class*='segment']"
  ));
  const rawLines = (segmentNodes.length ? segmentNodes : [transcriptRoot])
    .map((node) => node.innerText || node.textContent || "")
    .flatMap((text) => text.split(/\n+/));

  const transcript = rawLines
    .map(cleanTranscriptLine)
    .filter((line, index, lines) => line.length >= 3 && lines.indexOf(line) === index)
    .join(". ")
    .replace(/\s+/g, " ")
    .trim();

  return transcript.length >= 40 ? transcript : "";
}

function cleanTranscriptLine(line: string): string {
  return line
    .replace(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g, " ")
    .replace(/\bTranscript\b|\bShow transcript\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  vssId?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
};

function readCaptionTracks(): CaptionTrack[] {
  const response = readInitialPlayerResponse();
  return response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

function chooseCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  return tracks.find((track) => track.languageCode?.startsWith("en") && track.kind !== "asr")
    || tracks.find((track) => track.languageCode?.startsWith("en"))
    || tracks.find((track) => track.kind !== "asr")
    || tracks[0];
}

function addFormatToCaptionUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set("fmt", "json3");
  return url.toString();
}

function parseCaptionResponse(text: string): string {
  const jsonText = parseJsonCaptions(text);
  if (jsonText) return jsonText;

  const doc = new DOMParser().parseFromString(text, "text/xml");
  return Array.from(doc.querySelectorAll("text"))
    .map((node) => decodeHtml(node.textContent || ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonCaptions(text: string): string {
  try {
    const data = JSON.parse(text) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
    return data.events
      ?.flatMap((event) => event.segs || [])
      .map((seg) => seg.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim() || "";
  } catch {
    return "";
  }
}

function decodeHtml(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

function readInitialPlayerResponse(): any {
  const scripts = Array.from(document.scripts).slice(0, 80);
  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text.includes("ytInitialPlayerResponse")) continue;
    const json = extractAssignedJson(text, "ytInitialPlayerResponse");
    if (!json) continue;
    try {
      return JSON.parse(json);
    } catch {
      continue;
    }
  }
  return null;
}

function extractAssignedJson(text: string, variableName: string): string {
  const assignment = `${variableName} =`;
  const assignmentIndex = text.indexOf(assignment);
  const start = text.indexOf("{", assignmentIndex === -1 ? text.indexOf(`"${variableName}"`) : assignmentIndex);
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return "";
}

function cssEscape(value: string): string {
  return value.replace(/"/g, "\\\"");
}

async function expandDescription(): Promise<void> {
  const expandButton = findFirstElement([
    "ytd-watch-metadata #description-inline-expander #expand",
    "ytd-watch-metadata ytd-text-inline-expander #expand",
    "#description-inline-expander tp-yt-paper-button#expand",
    "#description-inline-expander button[aria-expanded='false']",
    "#description-inline-expander button[aria-label*='Show more' i]"
  ]);
  if (!expandButton) return;
  expandButton.click();
  await new Promise((resolve) => window.setTimeout(resolve, 250));
}

function retryRender(): void {
  if (renderAttempts >= 40) return;
  renderAttempts += 1;
  window.setTimeout(renderButton, 500);
}

function startWatchdog(): void {
  window.clearInterval(watchdogTimer);
  watchdogTimer = window.setInterval(() => {
    if (!isYouTubePage()) return;
    if (!document.getElementById(buttonId)) {
      renderButtonWithMode(false);
    }
  }, 2000);
}

function notifyReady(): void {
  const message: RuntimeMessage = { type: "CONTENT_SCRIPT_READY", url: location.href };
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function getStatus(): ContentStatus {
  return {
    loaded: true,
    url: location.href,
    isVideoPage: isVideoPage(),
    hasButton: Boolean(document.getElementById(buttonId)),
    title: readTitle(),
    descriptionLength: readDescription().length
  };
}

function injectStyle(): void {
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    #${buttonId}.cooking-mode-youtube-watch-button {
      box-sizing: border-box !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
      border: 0 !important;
      border-radius: 18px !important;
      background: var(--yt-spec-badge-chip-background, rgba(255, 255, 255, 0.12)) !important;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12) !important;
      color: var(--yt-spec-text-primary, #f1f1f1) !important;
      cursor: pointer !important;
      font: 500 14px/36px Roboto, Arial, sans-serif !important;
      height: 36px !important;
      margin-right: 8px !important;
      min-width: 78px !important;
      padding: 0 12px !important;
      position: relative !important;
      z-index: 10 !important;
      white-space: nowrap !important;
      vertical-align: middle !important;
      -webkit-tap-highlight-color: transparent !important;
    }

    #${buttonId}.cooking-mode-youtube-watch-button:hover {
      background: var(--yt-spec-mono-tonal-hover, rgba(255, 255, 255, 0.2)) !important;
    }

    #${buttonId}.cooking-mode-youtube-floating-button {
      position: fixed !important;
      right: 18px !important;
      bottom: 92px !important;
      z-index: 2147483647 !important;
      background: #d9471f !important;
      color: #fff !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28) !important;
    }

    #${buttonId}.cooking-mode-youtube-watch-button:disabled {
      opacity: 0.72 !important;
      cursor: default !important;
    }

    #${buttonId}.cooking-mode-youtube-watch-button .cooking-mode-icon {
      display: inline-flex !important;
      width: 20px !important;
      height: 20px !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 auto !important;
    }

    #${buttonId}.cooking-mode-youtube-watch-button .cooking-mode-icon svg {
      width: 20px !important;
      height: 20px !important;
      display: block !important;
      fill: currentColor !important;
    }

    #${buttonId}.cooking-mode-youtube-watch-button .cooking-mode-label {
      display: inline-block !important;
      line-height: 36px !important;
    }

    #${buttonId}.cooking-mode-youtube-shorts-button {
      box-sizing: border-box !important;
      width: 48px !important;
      min-height: 64px !important;
      padding: 6px 0 !important;
      margin: 0 0 10px !important;
      border: 0 !important;
      background: transparent !important;
      color: var(--yt-spec-static-brand-white, #fff) !important;
      cursor: pointer !important;
      font: 500 12px/1.2 Roboto, Arial, sans-serif !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 5px !important;
    }

    #${buttonId}.cooking-mode-youtube-shorts-button .cooking-mode-icon {
      width: 48px !important;
      height: 48px !important;
      border-radius: 50% !important;
      background: rgba(255, 255, 255, 0.18) !important;
      display: grid !important;
      place-items: center !important;
      color: currentColor !important;
    }

    #${buttonId}.cooking-mode-youtube-shorts-button .cooking-mode-icon svg {
      width: 24px !important;
      height: 24px !important;
      fill: currentColor !important;
      display: block !important;
    }

    #${buttonId}.cooking-mode-youtube-shorts-button:hover .cooking-mode-icon {
      background: rgba(255, 255, 255, 0.28) !important;
    }
  `;
  document.documentElement.append(style);
}

async function requestWakeLock(): Promise<boolean> {
  if (!("wakeLock" in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => notifyWakeLock(false));
    notifyWakeLock(true);
    return true;
  } catch {
    notifyWakeLock(false);
    return false;
  }
}

function releaseWakeLock(): void {
  window.clearTimeout(wakeLockTimer);
  if (!wakeLock) return;
  wakeLock.release().catch(() => undefined);
  wakeLock = null;
  notifyWakeLock(false);
}

function applyWakeLockMode(mode: WakeLockMode): void {
  wakeLockMode = mode;
  window.clearTimeout(wakeLockTimer);
  const video = document.querySelector<HTMLVideoElement>("video");
  video?.removeEventListener("ended", releaseWakeLock);
  if (mode === "video") {
    video?.addEventListener("ended", releaseWakeLock, { once: true });
    return;
  }
  wakeLockTimer = window.setTimeout(releaseWakeLock, Number(mode) * 60 * 1000);
}

async function handleVisibilityChange(): Promise<void> {
  if (document.visibilityState === "visible" && lastRecipe && !wakeLock) {
    await requestWakeLock();
  }
}

function notifyWakeLock(wakeLockActive: boolean): void {
  const message: RuntimeMessage = { type: "WAKE_LOCK_CHANGED", wakeLockActive };
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function waitForText(reader: () => string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  let value = reader();
  while (!value && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    value = reader();
  }
  return value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }).catch(() => {
      window.clearTimeout(timer);
      resolve(fallback);
    });
  });
}

function handleMessage(message: RuntimeMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: ContentStatus | ContentOpenResult) => void): true | void {
  if (message.type === "PING_CONTENT_SCRIPT") {
    sendResponse(getStatus());
    return true;
  }
  if (message.type === "REQUEST_OPEN_COOKING_MODE") {
    void prepareCookingMode()
      .then((result) => sendResponse({ ...getStatus(), ...result }))
      .catch((error) => sendResponse({ ...getStatus(), error: getErrorMessage(error) }));
    return true;
  }
  if (message.type === "SHOW_COOKING_BUTTON") {
    renderButtonWithMode(true);
    sendResponse(getStatus());
    return true;
  }
  if (message.type === "SET_WAKE_LOCK_MODE") {
    applyWakeLockMode(message.mode);
    sendResponse(getStatus());
    return true;
  }
  if (message.type === "END_COOKING_MODE") releaseWakeLock();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function setStage(stage: string): void {
  document.documentElement.dataset.cookingModeStage = stage;
}
