import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

test("recipe agent scrapes linked JSON-LD recipe pages", async () => {
  const recipeServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
      <html><head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Recipe",
            "name": "Test Vanilla Cake",
            "description": "A readable cake recipe.",
            "prepTime": "PT20M",
            "cookTime": "PT30M",
            "recipeYield": "12 slices",
            "recipeIngredient": ["2 cups flour", "1 cup sugar", "3 eggs"],
            "recipeInstructions": [
              {"@type":"HowToStep","text":"Preheat the oven."},
              {"@type":"HowToStep","text":"Mix the batter."},
              {"@type":"HowToStep","text":"Bake until done."}
            ]
          }
        </script>
      </head><body>Recipe</body></html>`);
  });
  await listen(recipeServer, 0);
  const recipePort = recipeServer.address().port;

  const agentPort = await freePort();
  const child = spawn(process.execPath, ["scripts/recipe-agent.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, COOKING_MODE_AGENT_PORT: String(agentPort) },
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    await waitForAgent(agentPort);
    const response = await fetch(`http://127.0.0.1:${agentPort}/recipe-agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "Vanilla cake",
          url: "https://youtube.com/watch?v=test",
          description: `Full recipe: http://127.0.0.1:${recipePort}/vanilla-cake-recipe`,
          transcript: ""
        },
        settings: {}
      })
    });
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.recipe.title, "Test Vanilla Cake");
    assert.deepEqual(data.recipe.ingredients, ["2 cups flour", "1 cup sugar", "3 eggs"]);
    assert.ok(data.recipe.instructions.some((step) => /preheat/i.test(step)));
    assert.equal(data.recipe.sourceNote, "Recipe pulled from the linked recipe website.");
  } finally {
    child.kill();
    await close(recipeServer);
  }
});

test("recipe agent uses local Ollama provider when no recipe link exists", async () => {
  const ollamaServer = createServer((request, response) => {
    assert.equal(request.url, "/api/generate");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      response: JSON.stringify({
        title: "AI Vanilla Cake",
        summary: "Local model recipe.",
        details: ["Prep: 20 minutes", "Bake: 30 minutes"],
        equipment: ["Cake pans", "Mixer"],
        ingredientGroups: [{ title: "Cake", items: ["2 cups flour", "1 cup sugar", "3 eggs"] }],
        instructionGroups: [{ title: "Bake", steps: ["Preheat oven.", "Mix batter.", "Bake cake."] }],
        notes: ["Cool before frosting."]
      })
    }));
  });
  await listen(ollamaServer, 0);
  const ollamaPort = ollamaServer.address().port;

  const agentPort = await freePort();
  const child = spawn(process.execPath, ["scripts/recipe-agent.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, COOKING_MODE_AGENT_PORT: String(agentPort) },
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    await waitForAgent(agentPort);
    const response = await fetch(`http://127.0.0.1:${agentPort}/recipe-agent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "The Most AMAZING Vanilla Cake Recipe",
          url: "https://youtube.com/watch?v=test",
          description: "No recipe link here.",
          transcript: "Add sugar and flour, then bake."
        },
        settings: {
          provider: "ollama",
          model: "llama3.2:3b",
          ollamaUrl: `http://127.0.0.1:${ollamaPort}`
        }
      })
    });
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.recipe.title, "AI Vanilla Cake");
    assert.equal(data.recipe.modelVersion, "agent-ollama-1");
    assert.ok(data.recipe.sourceNote.includes("Local Ollama"));
    assert.deepEqual(data.recipe.ingredientGroups[0].items, ["2 cups flour", "1 cup sugar", "3 eggs"]);
  } finally {
    child.kill();
    await close(ollamaServer);
  }
});

test("recipe agent supports OpenAI-compatible providers like Groq and DeepSeek", async () => {
  const apiServer = createServer((request, response) => {
    assert.equal(request.url, "/chat/completions");
    assert.equal(request.headers.authorization, "Bearer test-key");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            title: "Groq Cake",
            summary: "Provider recipe.",
            details: [],
            equipment: [],
            ingredientGroups: [{ title: "Cake", items: ["2 cups flour"] }],
            instructionGroups: [{ title: "Bake", steps: ["Preheat oven."] }],
            notes: []
          })
        }
      }]
    }));
  });
  await listen(apiServer, 0);
  const apiPort = apiServer.address().port;
  const agentPort = await freePort();
  const child = spawn(process.execPath, ["scripts/recipe-agent.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, COOKING_MODE_AGENT_PORT: String(agentPort) },
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    await waitForAgent(agentPort);
    const data = await postAgent(agentPort, {
      request: {
        title: "Cake Recipe",
        url: "https://youtube.com/watch?v=test",
        description: "No link.",
        transcript: "Bake a cake."
      },
      settings: {
        provider: "groq",
        apiKey: "test-key",
        apiBaseUrl: `http://127.0.0.1:${apiPort}/chat/completions`
      }
    });
    assert.equal(data.ok, true);
    assert.equal(data.recipe.title, "Groq Cake");
    assert.equal(data.recipe.modelVersion, "agent-groq-1");
  } finally {
    child.kill();
    await close(apiServer);
  }
});

test("recipe agent supports Gemini provider", async () => {
  const apiServer = createServer((request, response) => {
    assert.match(request.url, /^\/models\/gemini-test:?generateContent\?key=test-key$/);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({
            title: "Gemini Cake",
            ingredientGroups: [{ title: "Cake", items: ["flour"] }],
            instructionGroups: [{ title: "Bake", steps: ["Bake."] }]
          }) }]
        }
      }]
    }));
  });
  await listen(apiServer, 0);
  const apiPort = apiServer.address().port;
  const agentPort = await freePort();
  const child = spawn(process.execPath, ["scripts/recipe-agent.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, COOKING_MODE_AGENT_PORT: String(agentPort) },
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    await waitForAgent(agentPort);
    const data = await postAgent(agentPort, {
      request: { title: "Cake", url: "https://youtube.com/watch?v=test", description: "", transcript: "" },
      settings: {
        provider: "gemini",
        apiKey: "test-key",
        model: "gemini-test",
        apiBaseUrl: `http://127.0.0.1:${apiPort}`
      }
    });
    assert.equal(data.ok, true);
    assert.equal(data.recipe.title, "Gemini Cake");
    assert.equal(data.recipe.modelVersion, "agent-gemini-1");
  } finally {
    child.kill();
    await close(apiServer);
  }
});

test("recipe agent supports Claude provider", async () => {
  const apiServer = createServer((request, response) => {
    assert.equal(request.url, "/v1/messages");
    assert.equal(request.headers["x-api-key"], "test-key");
    assert.equal(request.headers["anthropic-version"], "2023-06-01");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      content: [{ text: JSON.stringify({
        title: "Claude Cake",
        ingredientGroups: [{ title: "Cake", items: ["flour"] }],
        instructionGroups: [{ title: "Bake", steps: ["Bake."] }]
      }) }]
    }));
  });
  await listen(apiServer, 0);
  const apiPort = apiServer.address().port;
  const agentPort = await freePort();
  const child = spawn(process.execPath, ["scripts/recipe-agent.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, COOKING_MODE_AGENT_PORT: String(agentPort) },
    stdio: ["ignore", "ignore", "pipe"]
  });

  try {
    await waitForAgent(agentPort);
    const data = await postAgent(agentPort, {
      request: { title: "Cake", url: "https://youtube.com/watch?v=test", description: "", transcript: "" },
      settings: {
        provider: "claude",
        apiKey: "test-key",
        apiBaseUrl: `http://127.0.0.1:${apiPort}/v1/messages`
      }
    });
    assert.equal(data.ok, true);
    assert.equal(data.recipe.title, "Claude Cake");
    assert.equal(data.recipe.modelVersion, "agent-claude-1");
  } finally {
    child.kill();
    await close(apiServer);
  }
});

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const server = createServer();
  await listen(server, 0);
  const port = server.address().port;
  await close(server);
  return port;
}

async function waitForAgent(port) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("agent did not start");
}

async function postAgent(port, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/recipe-agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}
