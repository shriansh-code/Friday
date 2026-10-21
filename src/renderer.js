const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "friday-local-settings-v1";
const HISTORY_KEY = "friday-local-history-v1";
const defaults = {
  apiUrl: "http://127.0.0.1:4891/v1",
  model: "Llama 3.2 1B Instruct",
  autoSpeak: false,
  voiceConcise: true
};
let settings = { ...defaults };
let history = [];
let busy = false;
let recognition = null;

try {
  settings = { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
} catch {}

$("api-url").value = settings.apiUrl;
$("model-id").value = settings.model;
$("auto-speak").checked = settings.autoSpeak;
$("voice-concise").checked = settings.voiceConcise;
$("model-label").textContent = settings.model;

function persistSettings() {
  settings = {
    apiUrl: $("api-url").value.trim() || defaults.apiUrl,
    model: $("model-id").value.trim() || defaults.model,
    autoSpeak: $("auto-speak").checked,
    voiceConcise: $("voice-concise").checked
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  $("model-label").textContent = settings.model;
}

function setStatus(connected, label) {
  $("status-label").textContent = label;
  $("status-dot").parentElement.classList.toggle("connected", !!connected);
}

async function checkConnection(showDetail = false) {
  persistSettings();
  setStatus(false, "Checking local AI…");
  const result = await window.friday.checkConnection(settings.apiUrl);
  setStatus(result.ok, result.ok ? "Local AI connected" : "Local AI offline");
  if (showDetail) $("connection-detail").textContent = result.ok
    ? `Connected. Models reported: ${result.models.length ? result.models.join(", ") : "server reachable"}`
    : result.message;
  return result;
}

function showView(name) {
  const isSettings = name === "settings";
  $("chat-view").classList.toggle("hidden", isSettings);
  $("settings-view").classList.toggle("hidden", !isSettings);
  $("page-title").textContent = isSettings ? "Settings" : "Assistant";
  document.querySelectorAll(".nav").forEach(n => n.classList.toggle("active", n.dataset.view === name));
}
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
$("new-chat").addEventListener("click", () => {
  history = [];
  saveHistory();
  $("messages").innerHTML = "";
  $("welcome").classList.remove("hidden");
  $("message-input").focus();
});
document.querySelectorAll(".suggestion").forEach(button => button.addEventListener("click", () => {
  $("message-input").value = button.dataset.prompt;
  sendMessage();
}));
$("test-connection").addEventListener("click", () => checkConnection(true));
$("save-settings").addEventListener("click", async () => {
  persistSettings();
  const result = await checkConnection(true);
  $("connection-detail").textContent = result.ok ? "Settings saved. Local model is reachable." : "Settings saved. " + result.message;
});
$("open-docs").addEventListener("click", () => window.friday.openUrl("https://docs.gpt4all.io/"));

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-80))); } catch {}
}
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function formatMessage(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  safe = safe.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}
function addMessage(role, content) {
  $("welcome").classList.add("hidden");
  const item = document.createElement("article");
  item.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "assistant" ? "F" : "Y";
  const body = document.createElement("div");
  body.className = "message-body";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatMessage(content);
  body.appendChild(bubble);
  if (role === "assistant") {
    const tools = document.createElement("div");
    tools.className = "message-tools";
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(content); copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", 1200); }
      catch { copy.textContent = "Clipboard unavailable"; }
    });
    const speak = document.createElement("button");
    speak.textContent = "Speak";
    speak.addEventListener("click", () => speakText(content));
    tools.append(copy, speak);
    body.appendChild(tools);
  }
  item.append(avatar, body);
  $("messages").appendChild(item);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function setBusy(value) {
  busy = value;
  $("send-btn").disabled = value;
  $("send-btn").textContent = value ? "Thinking…" : "Send ↗";
  $("typing").classList.toggle("hidden", !value);
}
function speakText(text) {
  if (!("speechSynthesis" in window)) {
    $("connection-detail").textContent = "Speech synthesis is not available on this system.";
    return;
  }
  window.speechSynthesis.cancel();
  const spoken = settings.voiceConcise && text.length > 1200 ? text.slice(0, 1200) + ". That's the main summary." : text;
  const utterance = new SpeechSynthesisUtterance(spoken.replace(/```[\s\S]*?```/g, " code block ").replace(/[*#`]/g, ""));
  utterance.rate = 1.02;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}
async function sendMessage() {
  if (busy) return;
  const text = $("message-input").value.trim();
  if (!text) return;
  $("message-input").value = "";
  $("message-input").style.height = "auto";
  history.push({ role: "user", content: text });
  addMessage("user", text);
  saveHistory();
  setBusy(true);
  try {
    const messages = [
      { role: "system", content: "You are FRIDAY, a helpful, honest, concise desktop voice assistant. You run locally and have no access to the internet unless explicitly provided. Do not claim to perform actions on the computer unless a tool actually did them. Use clear language and format code in fenced code blocks." },
      ...history.slice(-20)
    ];
    const result = await window.friday.chat({
      baseUrl: settings.apiUrl,
      model: settings.model,
      messages,
      temperature: 0.7,
      maxTokens: 450
    });
    history.push({ role: "assistant", content: result.content });
    addMessage("assistant", result.content);
    saveHistory();
    if (settings.autoSpeak) speakText(result.content);
  } catch (error) {
    const msg = `I couldn't connect to the local model.\n\n${error.message}\n\nOpen GPT4All, load your Llama model, enable its Local API Server, and test the connection in Settings.`;
    addMessage("assistant", msg);
  } finally {
    setBusy(false);
    $("message-input").focus();
  }
}
$("composer").addEventListener("submit", e => { e.preventDefault(); sendMessage(); });
$("message-input").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$("message-input").addEventListener("input", () => {
  $("message-input").style.height = "auto";
  $("message-input").style.height = Math.min($("message-input").scrollHeight, 150) + "px";
});

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addMessage("assistant", "Voice input isn't available in this Electron build. Text chat and spoken replies still work. For a fully offline microphone, we can add a local speech-recognition engine in a later version.");
    return;
  }
  if (recognition) { recognition.stop(); recognition = null; $("voice-input").innerHTML = "🎙 <span>Speak</span>"; return; }
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => { $("voice-input").innerHTML = "⏹ <span>Stop</span>"; };
  recognition.onresult = event => {
    $("message-input").value = event.results[0][0].transcript;
    if ($("message-input").value.trim()) sendMessage();
  };
  recognition.onerror = event => addMessage("assistant", `Microphone input error: ${event.error}. You can continue typing. Speech recognition availability depends on your system.`);
  recognition.onend = () => { recognition = null; $("voice-input").innerHTML = "🎙 <span>Speak</span>"; };
  recognition.start();
}
$("voice-input").addEventListener("click", startVoiceInput);
window.addEventListener("beforeunload", () => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); });

(async () => {
  history.forEach(m => { if (m && ["user", "assistant"].includes(m.role) && typeof m.content === "string") addMessage(m.role, m.content); });
  await checkConnection(false);
})();
