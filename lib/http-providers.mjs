function requiredEnv(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`missing env ${name}`);
  }
  return value.trim();
}

function baseUrl(env, name, fallback) {
  const value = env?.[name];
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.trim().replace(/\/+$/, "");
}

function assertOutput(id, text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error(`${id}: empty output`);
  }
  return text;
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

async function postJson(id, url, headers, body, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });
  const raw = await response.text();
  if (!response.ok) {
    const detail = raw.replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(detail ? `${id}: HTTP ${response.status} ${detail}` : `${id}: HTTP ${response.status}`);
  }
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${id}: invalid JSON`);
  }
}

async function invokeOpenAI(prompt, env, signal) {
  const base = baseUrl(env, "OPENAI_BASE_URL", "https://api.openai.com/v1");
  const data = await postJson(
    "openai",
    `${base}/chat/completions`,
    env.OPENAI_API_KEY ? { authorization: `Bearer ${env.OPENAI_API_KEY}` } : {},
    {
      model: requiredEnv(env, "OPENAI_MODEL"),
      messages: [{ role: "user", content: prompt }],
    },
    signal,
  );
  return assertOutput("openai", textFromContent(data?.choices?.[0]?.message?.content));
}

async function invokeAnthropic(prompt, env, signal) {
  const data = await postJson(
    "anthropic",
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": requiredEnv(env, "ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
    },
    {
      model: requiredEnv(env, "ANTHROPIC_MODEL"),
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    },
    signal,
  );
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  return assertOutput("anthropic", text);
}

async function invokeGemini(prompt, env, signal) {
  const model = requiredEnv(env, "GEMINI_MODEL");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const data = await postJson(
    "gemini",
    url,
    { "x-goog-api-key": requiredEnv(env, "GEMINI_API_KEY") },
    { contents: [{ role: "user", parts: [{ text: prompt }] }] },
    signal,
  );
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.filter((part) => part && typeof part.text === "string").map((part) => part.text).join("")
    : "";
  return assertOutput("gemini", text);
}

async function invokeOllama(prompt, env, signal) {
  const base = baseUrl(env, "OLLAMA_BASE_URL", "http://127.0.0.1:11434");
  const data = await postJson(
    "ollama",
    `${base}/api/chat`,
    {},
    {
      model: requiredEnv(env, "OLLAMA_MODEL"),
      messages: [{ role: "user", content: prompt }],
      stream: false,
    },
    signal,
  );
  return assertOutput("ollama", textFromContent(data?.message?.content));
}

const providers = {
  openai: invokeOpenAI,
  anthropic: invokeAnthropic,
  gemini: invokeGemini,
  ollama: invokeOllama,
};

export async function invokeHttp(id, prompt, env = process.env) {
  if (typeof prompt !== "string") {
    throw new TypeError("prompt must be a string");
  }
  const provider = providers[id];
  if (!provider) {
    throw new Error(`unsupported id: ${id}`);
  }
  return provider(prompt, env ?? process.env, AbortSignal.timeout(120000));
}
