const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

const DEFAULT_BASE_URL = "http://127.0.0.1:4891/v1";

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#090d16",
    title: "FRIDAY — Local AI",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function normalizeBaseUrl(url) {
  const candidate = String(url || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new Error("Enter a valid local API URL."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP or HTTPS local API URLs are supported.");
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("For privacy, FRIDAY only connects to a local server on this computer.");
  }
  return candidate.replace(/\/chat\/completions$/i, "").replace(/\/models$/i, "");
}

ipcMain.handle("friday:check-connection", async (_event, baseUrl) => {
  const base = normalizeBaseUrl(baseUrl);
  try {
    const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, message: `Server returned HTTP ${response.status}.` };
    const data = await response.json();
    const models = Array.isArray(data.data) ? data.data.map(x => x.id).filter(Boolean) : [];
    return { ok: true, message: "Connected to local API", models };
  } catch (error) {
    return {
      ok: false,
      message: "Could not reach GPT4All. Open GPT4All, enable its Local API Server, and check the port (usually 4891)."
    };
  }
});

ipcMain.handle("friday:chat", async (_event, payload) => {
  const base = normalizeBaseUrl(payload?.baseUrl);
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (!messages.length) throw new Error("Add a message before sending.");
  const safeMessages = messages.slice(-20).map(m => ({
    role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user",
    content: String(m.content ?? "").slice(0, 12000)
  }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: String(payload?.model || "Llama 3.2 1B Instruct"),
        messages: safeMessages,
        temperature: Math.min(1.2, Math.max(0, Number(payload?.temperature ?? 0.7))),
        max_tokens: Math.min(1024, Math.max(32, Number(payload?.maxTokens ?? 400))),
        stream: false
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Local API error (${response.status}). ${detail.slice(0, 300)}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("The model returned an empty response. Check that a model is loaded in GPT4All.");
    return { content: String(content) };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The model took too long to respond. Try a shorter message or smaller context.");
    throw new Error(error.message || "Could not contact the local model.");
  } finally {
    clearTimeout(timeout);
  }
});

ipcMain.handle("friday:open-url", async (_event, url) => {
  const parsed = new URL(String(url));
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Unsupported URL.");
  await shell.openExternal(parsed.toString());
  return true;
});
