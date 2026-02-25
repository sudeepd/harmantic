import type { Recorder } from "./recorder";
import { generateTests } from "./generator";
import { loadSettings, saveSettings, isConfigured, type Settings } from "./settings";
import { validateKey } from "./llm";

export async function renderPanel(root: HTMLElement, recorder: Recorder) {
  const settings = await loadSettings();

  if (!isConfigured(settings)) {
    renderSetup(root, async (saved) => {
      Object.assign(settings, saved);
      renderMain(root, recorder, settings);
    });
  } else {
    renderMain(root, recorder, settings);
  }
}

// ---------------------------------------------------------------------------
// Setup screen — shown when no API key is configured
// ---------------------------------------------------------------------------

function renderSetup(root: HTMLElement, onDone: (s: Settings) => void) {
  root.innerHTML = `
    <div class="setup">
      <div class="setup-logo">⚡ Harmantic</div>
      <div class="setup-subtitle">AI-powered API test recorder</div>
      <div class="setup-form">
        <label>LLM model
          <input type="text" id="setup-model" value="anthropic/claude-sonnet-4-20250514" />
          <span class="hint">Use <code>anthropic/…</code> or <code>openai/…</code></span>
        </label>
        <label>API key
          <input type="password" id="setup-key" placeholder="sk-ant-… or sk-…" autofocus />
        </label>
        <label>Output format
          <select id="setup-format">
            <option value="pytest">pytest + httpx (Python)</option>
            <option value="jest">Jest (TypeScript)</option>
            <option value="playwright">Playwright</option>
          </select>
        </label>
        <button class="btn primary wide" id="setup-save">Get started</button>
        <div class="setup-error hidden" id="setup-error"></div>
      </div>
    </div>
  `;

  const modelInput = document.getElementById("setup-model") as HTMLInputElement;
  const keyInput = document.getElementById("setup-key") as HTMLInputElement;
  const formatSelect = document.getElementById("setup-format") as HTMLSelectElement;
  const saveBtn = document.getElementById("setup-save")!;
  const errorDiv = document.getElementById("setup-error")!;

  saveBtn.addEventListener("click", async () => {
    const apiKey = keyInput.value.trim();
    const model = modelInput.value.trim();
    errorDiv.classList.add("hidden");

    if (!apiKey) {
      errorDiv.textContent = "API key is required.";
      errorDiv.classList.remove("hidden");
      return;
    }
    if (!model.includes("/")) {
      errorDiv.textContent = 'Model must be "vendor/model" (e.g. anthropic/claude-sonnet-4-20250514)';
      errorDiv.classList.remove("hidden");
      return;
    }

    saveBtn.textContent = "Validating key…";
    saveBtn.setAttribute("disabled", "true");

    try {
      await validateKey({ model, apiKey });
    } catch (e) {
      errorDiv.textContent = `Key validation failed: ${(e as Error).message}`;
      errorDiv.classList.remove("hidden");
      saveBtn.textContent = "Get started";
      saveBtn.removeAttribute("disabled");
      return;
    }

    const s: Settings = { apiKey, model, format: formatSelect.value as Settings["format"] };
    await saveSettings(s);
    onDone(s);
  });

  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

function renderMain(root: HTMLElement, recorder: Recorder, settings: Settings) {
  root.innerHTML = `
    <div class="toolbar">
      <button class="btn record-btn" id="btn-record">● Record</button>
      <button class="btn" id="btn-mark" disabled>Mark Flow</button>
      <button class="btn" id="btn-clear">Clear</button>
      <span class="badge" id="badge-count">0 requests</span>
      <div style="flex:1"></div>
      <span class="model-badge" id="model-badge">${shortModel(settings.model)}</span>
      <button class="btn" id="btn-settings" title="Settings">⚙</button>
      <button class="btn primary" id="btn-generate" disabled>Generate Tests</button>
    </div>
    <div class="flow-list" id="flow-list">
      <div class="empty-state">
        <div>Press <strong>● Record</strong> then use your app</div>
        <div style="margin-top:4px;font-size:11px;color:#555">Optionally press <strong>Mark Flow</strong> between test cases</div>
      </div>
    </div>
    <div class="status-bar" id="status-bar">
      Ready — LLM: ${settings.model}
    </div>

    <!-- Settings modal -->
    <div class="modal-backdrop hidden" id="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <span>Settings</span>
          <button class="btn" id="btn-close-settings">✕</button>
        </div>
        <div class="modal-body">
          <label>Output format
            <select id="setting-format">
              <option value="pytest">pytest + httpx (Python)</option>
              <option value="jest">Jest (TypeScript)</option>
              <option value="playwright">Playwright</option>
            </select>
          </label>
          <label>LLM model
            <input type="text" id="setting-model" />
          </label>
          <label>API key
            <input type="password" id="setting-api-key" />
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn primary" id="btn-save-settings">Save</button>
        </div>
      </div>
    </div>
  `;

  const btnRecord = document.getElementById("btn-record")!;
  const btnMark = document.getElementById("btn-mark") as HTMLButtonElement;
  const btnClear = document.getElementById("btn-clear")!;
  const btnGenerate = document.getElementById("btn-generate") as HTMLButtonElement;
  const btnSettings = document.getElementById("btn-settings")!;
  const btnCloseSettings = document.getElementById("btn-close-settings")!;
  const btnSaveSettings = document.getElementById("btn-save-settings")!;
  const badgeCount = document.getElementById("badge-count")!;
  const statusBar = document.getElementById("status-bar")!;
  const flowList = document.getElementById("flow-list")!;
  const modelBadge = document.getElementById("model-badge")!;
  const modalBackdrop = document.getElementById("modal-backdrop")!;
  const settingFormat = document.getElementById("setting-format") as HTMLSelectElement;
  const settingModel = document.getElementById("setting-model") as HTMLInputElement;
  const settingApiKey = document.getElementById("setting-api-key") as HTMLInputElement;

  settingFormat.value = settings.format;
  settingModel.value = settings.model;
  settingApiKey.value = settings.apiKey;

  // Poll request count
  const countTimer = setInterval(() => {
    const n = recorder.entryCount;
    badgeCount.textContent = `${n} requests`;
    btnGenerate.disabled = n === 0 || recorder.recording;
  }, 500);

  // Record
  btnRecord.addEventListener("click", async () => {
    if (recorder.recording) {
      recorder.stop();
      btnRecord.textContent = "● Record";
      btnRecord.classList.remove("recording");
      btnMark.disabled = false;
      statusBar.textContent = `Stopped — ${recorder.entryCount} requests captured`;
    } else {
      btnRecord.setAttribute("disabled", "true");
      statusBar.textContent = "Starting…";
      await recorder.start();
      btnRecord.removeAttribute("disabled");
      btnRecord.textContent = "■ Stop";
      btnRecord.classList.add("recording");
      btnMark.disabled = false;
      statusBar.textContent = "Recording — page navigation and requests captured";
    }
  });

  // Mark flow
  btnMark.addEventListener("click", () => {
    const label = prompt("Flow name:", `flow_${recorder.getMarkers().length + 1}`);
    if (!label) return;
    recorder.markFlow(label);
    renderMarkers(flowList, recorder.getMarkers());
    statusBar.textContent = `Marker added: ${label}`;
  });

  // Clear
  btnClear.addEventListener("click", () => {
    if (recorder.entryCount > 0 && !confirm("Clear all recorded requests and markers?")) return;
    recorder.clear();
    btnMark.disabled = true;
    btnGenerate.disabled = true;
    flowList.innerHTML = `<div class="empty-state">
      <div>Press <strong>● Record</strong> then use your app</div>
    </div>`;
    statusBar.textContent = "Cleared";
  });

  // Settings modal
  btnSettings.addEventListener("click", () => modalBackdrop.classList.remove("hidden"));
  btnCloseSettings.addEventListener("click", () => modalBackdrop.classList.add("hidden"));
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) modalBackdrop.classList.add("hidden");
  });

  btnSaveSettings.addEventListener("click", async () => {
    const newKey = settingApiKey.value.trim();
    const newModel = settingModel.value.trim();

    // Only re-validate if key or model changed
    if (newKey !== settings.apiKey || newModel !== settings.model) {
      btnSaveSettings.textContent = "Validating…";
      btnSaveSettings.setAttribute("disabled", "true");
      try {
        await validateKey({ model: newModel, apiKey: newKey });
      } catch (e) {
        statusBar.textContent = `Key validation failed: ${(e as Error).message}`;
        btnSaveSettings.textContent = "Save";
        btnSaveSettings.removeAttribute("disabled");
        return;
      }
      btnSaveSettings.textContent = "Save";
      btnSaveSettings.removeAttribute("disabled");
    }

    settings.format = settingFormat.value as Settings["format"];
    settings.model = newModel;
    settings.apiKey = newKey;
    await saveSettings(settings);
    modelBadge.textContent = shortModel(settings.model);
    statusBar.textContent = `Settings saved — model: ${settings.model}`;
    modalBackdrop.classList.add("hidden");
  });

  // Generate
  btnGenerate.addEventListener("click", async () => {
    const entries = recorder.getEntries();
    if (entries.length === 0) return;

    btnGenerate.disabled = true;
    btnRecord.setAttribute("disabled", "true");
    const ext = settings.format === "pytest" ? "py" : "ts";

    try {
      const code = await generateTests(
        entries,
        recorder.getMarkers(),
        {
          baseUrl: extractBaseUrl(entries),
          format: settings.format,
          navEvents: recorder.getNavEvents(),
          llm: { model: settings.model, apiKey: settings.apiKey },
        },
        (msg) => { statusBar.textContent = msg; }
      );
      downloadFile(`test_session.${ext}`, code);
      downloadFile("session.har", buildHar(entries));
      statusBar.textContent = `Done — ${recorder.getMarkers().length || "auto"} flows generated`;
    } catch (e) {
      statusBar.textContent = `Error: ${(e as Error).message}`;
    } finally {
      btnGenerate.disabled = false;
      btnRecord.removeAttribute("disabled");
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMarkers(container: HTMLElement, markers: { label: string }[]) {
  container.innerHTML = markers.map(m => `
    <div class="flow-item">
      <span class="flow-name">${m.label}</span>
      <span class="flow-meta">flow marker</span>
    </div>
  `).join("");
}

function extractBaseUrl(entries: { request: { url: string } }[]): string {
  if (entries.length === 0) return "";
  try {
    const u = new URL(entries[0].request.url);
    return `${u.protocol}//${u.host}`;
  } catch { return ""; }
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildHar(entries: { request: unknown; response: unknown; startedDateTime: string; time: number }[]): string {
  const har = {
    log: {
      version: "1.2",
      creator: { name: "Harmantic", version: "0.1.0" },
      entries: entries.map(e => ({
        startedDateTime: e.startedDateTime,
        time: e.time,
        request: e.request,
        response: e.response,
      })),
    },
  };
  return JSON.stringify(har, null, 2);
}

function shortModel(model: string): string {
  // "anthropic/claude-sonnet-4-20250514" -> "claude-sonnet-4"
  const name = model.split("/").pop() ?? model;
  return name.replace(/-\d{8}$/, "");
}
