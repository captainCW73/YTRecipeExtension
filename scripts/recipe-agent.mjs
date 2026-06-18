import { createServer } from "node:http";

const port = Number(process.env.COOKING_MODE_AGENT_PORT || 8787);

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    writeJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST" || request.url !== "/recipe-agent") {
    writeJson(response, 404, { ok: false, error: "not found" });
    return;
  }

  try {
    const body = await readJson(request);
    const recipe = await extractRecipe(body);
    if (recipe) writeJson(response, 200, { ok: true, recipe });
    else writeJson(response, 200, { ok: false, error: "no video-supported recipe" });
  } catch (error) {
    writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Cooking Mode recipe agent running at http://127.0.0.1:${port}`);
});

async function extractRecipe(body) {
  const request = body.request || {};
  const settings = body.settings || {};

  for (const provider of providerOrder(settings)) {
    const recipe = await aiRecipe(request, settings, provider).catch(() => null);
    if (recipe) return recipe;
  }

  return null;
}

function providerOrder(settings) {
  const provider = settings.provider || "ollama";
  if (provider === "ollama") return settings.apiKey ? ["ollama", "openai"] : ["ollama"];
  return settings.apiKey ? [provider, "ollama"] : ["ollama"];
}

function recipeLinks(text) {
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s<>"']+/gi))
    .map((match) => match[0].replace(/[),.]+$/g, ""));
  return urls.filter((url) => {
    const lower = url.toLowerCase();
    return /recipe|cake|cook|bake|food|kitchen|ingredient|preppy|sally|seriouseats|allrecipes|foodnetwork|bonappetit/.test(lower)
      && !/youtube|youtu\.be|instagram|tiktok|facebook|twitter|x\.com|amazon|shop|merch/.test(lower);
  }).slice(0, 5);
}

async function scrapeRecipePage(url, fallbackTitle) {
  const html = await fetchText(url);
  const jsonLdRecipes = extractJsonLdRecipes(html);
  const jsonLd = jsonLdRecipes[0];
  if (jsonLd) return normalizeJsonLdRecipe(jsonLd, url, fallbackTitle);
  return scrapeHtmlHeuristic(html, url, fallbackTitle);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "CookingModeRecipeAgent/1.0",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`recipe page ${response.status}`);
  return response.text();
}

function extractJsonLdRecipes(html) {
  const scripts = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
    .map((match) => decodeHtml(stripTags(match[1]).trim()));
  const recipes = [];
  for (const script of scripts) {
    try {
      collectRecipeJson(JSON.parse(script), recipes);
    } catch {
      continue;
    }
  }
  return recipes;
}

function collectRecipeJson(value, recipes) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecipeJson(item, recipes));
    return;
  }
  if (typeof value !== "object") return;
  const type = value["@type"];
  if ((Array.isArray(type) && type.includes("Recipe")) || type === "Recipe") recipes.push(value);
  collectRecipeJson(value["@graph"], recipes);
}

function normalizeJsonLdRecipe(data, url, fallbackTitle) {
  const ingredients = arrayText(data.recipeIngredient || data.ingredients);
  const instructions = normalizeInstructions(data.recipeInstructions);
  return {
    title: cleanText(data.name || fallbackTitle || "Recipe"),
    url,
    summary: cleanText(data.description || ""),
    details: [
      formatDetail("Prep", data.prepTime),
      formatDetail("Cook", data.cookTime),
      formatDetail("Total", data.totalTime),
      formatDetail("Yield", arrayText(data.recipeYield).join(", "))
    ].filter(Boolean),
    equipment: arrayText(data.tool || data.recipeEquipment || []),
    ingredientGroups: [{ title: "Ingredients", items: ingredients }],
    instructionGroups: [{ title: "Instructions", steps: instructions }],
    notes: [],
    ingredients,
    instructions,
    fallbackText: "",
    extractedAt: Date.now(),
    likelyCooking: true,
    source: "local-model",
    sourceNote: "Recipe pulled from the linked recipe website.",
    modelConfidence: 0.95,
    modelVersion: "agent-web-1"
  };
}

function scrapeHtmlHeuristic(html, url, fallbackTitle) {
  const title = cleanText(matchMeta(html, "og:title") || matchTag(html, "h1") || fallbackTitle || "Recipe");
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<\/(p|li|h2|h3|div|section|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = decodeHtml(text).split("\n").map(cleanText).filter(Boolean);
  const ingredients = sectionLines(lines, /ingredients/i, /instructions|directions|method|notes|nutrition/i)
    .filter((line) => /\d|cup|tbsp|tsp|gram|ounce|pound|flour|sugar|butter|egg|milk|salt|vanilla/i.test(line))
    .slice(0, 40);
  const instructions = sectionLines(lines, /instructions|directions|method/i, /notes|nutrition|comments/i)
    .filter((line) => /\b(preheat|mix|whisk|add|bake|cook|cool|beat|fold|serve|frost|combine)\b/i.test(line))
    .slice(0, 30);
  if (ingredients.length < 2 && instructions.length < 2) return null;
  return {
    title,
    url,
    summary: "",
    details: [],
    equipment: [],
    ingredientGroups: [{ title: "Ingredients", items: ingredients }],
    instructionGroups: [{ title: "Instructions", steps: instructions }],
    notes: [],
    ingredients,
    instructions,
    fallbackText: "",
    extractedAt: Date.now(),
    likelyCooking: true,
    source: "local-model",
    sourceNote: "Recipe pulled from the linked recipe website.",
    modelConfidence: 0.78,
    modelVersion: "agent-web-1"
  };
}

async function aiRecipe(request, settings, provider) {
  const prompt = `Extract a recipe card ONLY from this specific YouTube video's provided description and captions.
Return ONLY JSON with title, summary, details array, equipment array, ingredientGroups [{title,items}], instructionGroups [{title,steps}], notes array.
Trust rule:
- Do not use outside recipe knowledge.
- Do not use the title to infer ingredients, measurements, seasoning, temperatures, timing, or steps.
- Do not add common ingredients unless the description/captions explicitly mention them.
- Preserve the video's actual order of operations.
- If a measurement is not present, omit the measurement.
- If steps are not present, return an empty instructionGroups array.
- If ingredients are not present, return an empty ingredientGroups array.
- Summaries and notes must only describe facts present in the description/captions.

Title: ${request.title}
URL: ${request.url}
Description:
${request.description}

Captions/transcript:
${request.transcript}`;

  if (provider === "ollama") return ollamaRecipe(request, settings, prompt);
  if (provider === "gemini") return geminiRecipe(request, settings, prompt);
  if (provider === "claude") return claudeRecipe(request, settings, prompt);
  return openAiCompatibleRecipe(request, settings, provider, prompt);
}

async function ollamaRecipe(request, settings, prompt) {
  const baseUrl = (settings.ollamaUrl || "http://127.0.0.1:11434").replace(/\/+$/g, "");
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.model || "llama3.2:3b",
      prompt,
      stream: false,
      format: "json",
      options: { temperature: 0.2 }
    })
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  const data = await response.json();
  const parsed = JSON.parse(extractJsonText(data.response || ""));
  return normalizeAiRecipe(parsed, request, "Local Ollama extracted this only from the YouTube description and captions.", "agent-ollama-1");
}

async function openAiCompatibleRecipe(request, settings, provider, prompt) {
  if (!settings.apiKey) throw new Error(`missing ${provider} API key`);
  const response = await fetch(apiBaseUrl(settings, provider), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || defaultModel(provider),
      messages: [
        { role: "system", content: "You are a precise recipe extraction assistant. Use only the provided YouTube description and captions. Never infer missing ingredients or steps. Return strict JSON only." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    })
  });
  if (!response.ok) throw new Error(`${provider} ${response.status}`);
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(extractJsonText(raw));
  return normalizeAiRecipe(parsed, request, `${providerLabel(provider)} extracted this only from the YouTube description and captions.`, `agent-${provider}-1`);
}

async function geminiRecipe(request, settings, prompt) {
  if (!settings.apiKey) throw new Error("missing Gemini API key");
  const model = settings.model || "gemini-1.5-flash";
  const base = (settings.apiBaseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/g, "");
  const response = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    })
  });
  if (!response.ok) throw new Error(`gemini ${response.status}`);
  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const parsed = JSON.parse(extractJsonText(raw));
  return normalizeAiRecipe(parsed, request, "Gemini extracted this only from the YouTube description and captions.", "agent-gemini-1");
}

async function claudeRecipe(request, settings, prompt) {
  if (!settings.apiKey) throw new Error("missing Claude API key");
  const response = await fetch(settings.apiBaseUrl || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: settings.model || "claude-3-5-haiku-latest",
      max_tokens: 1800,
      temperature: 0.2,
      system: "You are a precise recipe extraction assistant. Use only the provided YouTube description and captions. Never infer missing ingredients or steps. Return strict JSON only.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`claude ${response.status}`);
  const data = await response.json();
  const raw = data.content?.map((part) => part.text || "").join("") || "";
  const parsed = JSON.parse(extractJsonText(raw));
  return normalizeAiRecipe(parsed, request, "Claude extracted this only from the YouTube description and captions.", "agent-claude-1");
}

function apiBaseUrl(settings, provider) {
  if (settings.apiBaseUrl) return settings.apiBaseUrl;
  if (provider === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  if (provider === "deepseek") return "https://api.deepseek.com/chat/completions";
  return "https://api.openai.com/v1/chat/completions";
}

function defaultModel(provider) {
  if (provider === "groq") return "llama-3.1-8b-instant";
  if (provider === "deepseek") return "deepseek-chat";
  return "gpt-4o-mini";
}

function providerLabel(provider) {
  if (provider === "groq") return "Groq";
  if (provider === "deepseek") return "DeepSeek";
  return "OpenAI";
}

function normalizeAiRecipe(data, request, sourceNote = "AI agent extracted this only from the YouTube description and captions.", modelVersion = "agent-ai-1") {
  const ingredientGroups = normalizeGroups(data.ingredientGroups, "Ingredients", "items");
  const instructionGroups = normalizeGroups(data.instructionGroups, "Instructions", "steps");
  const ingredients = ingredientGroups.flatMap((group) => group.items);
  const instructions = instructionGroups.flatMap((group) => group.steps);
  if (!ingredients.length && !instructions.length) return null;
  return {
    title: cleanText(data.title || request.title || "Recipe"),
    url: request.url,
    summary: cleanText(data.summary || ""),
    details: arrayText(data.details),
    equipment: arrayText(data.equipment),
    ingredientGroups,
    instructionGroups,
    notes: arrayText(data.notes),
    ingredients,
    instructions,
    fallbackText: "",
    extractedAt: Date.now(),
    likelyCooking: true,
    source: "local-model",
    sourceNote,
    modelConfidence: 0.82,
    modelVersion
  };
}

function normalizeGroups(groups, fallbackTitle, itemKey) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group, index) => ({
    title: cleanText(group?.title || (index === 0 ? fallbackTitle : `${fallbackTitle} ${index + 1}`)),
    [itemKey]: arrayText(group?.[itemKey])
  })).filter((group) => group[itemKey].length);
}

function extractJsonText(text) {
  const cleaned = String(text || "").replace(/^```json\s*|\s*```$/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start === -1 || end === -1 ? cleaned : cleaned.slice(start, end + 1);
}

function normalizeInstructions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return cleanText(item);
      if (Array.isArray(item.itemListElement)) return normalizeInstructions(item.itemListElement);
      return cleanText(item.text || item.name || "");
    }).filter(Boolean);
  }
  return [cleanText(value)].filter(Boolean);
}

function sectionLines(lines, startPattern, stopPattern) {
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start === -1) return [];
  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (stopPattern.test(lines[index]) && out.length) break;
    if (lines[index].length <= 220) out.push(lines[index]);
  }
  return out;
}

function arrayText(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((item) => cleanText(typeof item === "string" ? item : item?.text || item?.name || "")).filter(Boolean);
}

function formatDetail(label, value) {
  const text = arrayText(value).join(", ");
  return text ? `${label}: ${text}` : "";
}

function matchMeta(html, property) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["']`, "i");
  return decodeHtml(html.match(pattern)?.[1] || "");
}

function matchTag(html, tag) {
  return decodeHtml(stripTags(html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || ""));
}

function stripTags(text) {
  return text.replace(/<[^>]+>/g, " ");
}

function cleanText(value) {
  return decodeHtml(String(value || "")).replace(/\s+/g, " ").trim();
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function writeJson(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(status === 204 ? "" : JSON.stringify(data));
}
