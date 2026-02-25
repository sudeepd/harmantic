import type { Recorder } from "./recorder";
import { generateTests } from "./generator";
import { loadSettings, saveSettings, type Settings } from "./settings";

export async function renderPanel(root: HTMLElement, recorder: Recorder) {
  const settings = await loadSettings();

  root.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="btn-record">Start Recording</button>
      <button class="btn" id="btn-mark">Mark Flow</button>
      <button class="btn" id="btn-clear">Clear</button>
      <span class="badge" id="badge-count">0 requests</span>
      <div style="flex:1"></div>
      <button class="btn" id="btn-settings" title="Settings">⚙</button>
      <button class="btn primary" id="btn-generate">Generate Tests</button>
    </div>
    <div class="flow-list" id="flow-list">
      <div class="empty-state">
        <div>Press <strong>Start Recording</strong> then use your app</div>
        <div>Press <strong>Mark Flow</strong> to separate test cases</div>
      </div>
    </div>
    <div class="status-bar" id="status-bar">Ready</div>

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
              <option value="pytest">pytest + httpx</option>
              <option value="jest">Jest (fetch)</option>
              <option value="playwright">Playwright</option>
            </select>
          </label>
          <label class="row">
            <input type="checkbox" id="setting-use-llm" />
            Enable LLM enrichment
          </label>
          <label>LLM model
            <input type="text" id="setting-model" placeholder="anthropic/claude-sonnet-4-20250514" />
          </label>
          <label>API key
            <input type="password" id="setting-api-key" placeholder="sk-ant-... or sk-..." />
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn primary" id="btn-save-settings">Save</button>
        </div>
      </div>
    </div>
  `;

  // Wire up elements
  const btnRecord = document.getElementById("btn-record")!;
  const btnMark = document.getElementById("btn-mark")!;
  const btnClear = document.getElementById("btn-clear")!;
  const btnGenerate = document.getElementById("btn-generate")!;
  const btnSettings = document.getElementById("btn-settings")!;
  const btnCloseSettings = document.getElementById("btn-close-settings")!;
  const btnSaveSettings = document.getElementById("btn-save-settings")!;
  const badgeCount = document.getElementById("badge-count")!;
  const statusBar = document.getElementById("status-bar")!;
  const flowList = document.getElementById("flow-list")!;
  const modalBackdrop = document.getElementById("modal-backdrop")!;
  const settingFormat = document.getElementById("setting-format") as HTMLSelectElement;
  const settingUseLlm = document.getElementById("setting-use-llm") as HTMLInputElement;
  const settingModel = document.getElementById("setting-model") as HTMLInputElement;
  const settingApiKey = document.getElementById("setting-api-key") as HTMLInputElement;

  // Populate settings form
  settingFormat.value = settings.format;
  settingUseLlm.checked = settings.useLlm;
  settingModel.value = settings.model;
  settingApiKey.value = settings.apiKey;

  // Poll request count
  setInterval(() => {
    badgeCount.textContent = `${recorder.entryCount} requests`;
  }, 500);

  // Record
  btnRecord.addEventListener("click", () => {
    if (recorder.recording) {
      recorder.stop();
      btnRecord.textContent = "Start Recording";
      btnRecord.classList.remove("recording");
      statusBar.textContent = `Stopped — ${recorder.entryCount} requests captured`;
    } else {
      recorder.start();
      btnRecord.textContent = "Stop Recording";
      btnRecord.classList.add("recording");
      statusBar.textContent = "Recording…";
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
    if (!confirm("Clear all recorded requests and markers?")) return;
    recorder.clear();
    flowList.innerHTML = `<div class="empty-state">
      <div>Press <strong>Start Recording</strong> then use your app</div>
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
    const updated: Settings = {
      format: settingFormat.value as Settings["format"],
      useLlm: settingUseLlm.checked,
      model: settingModel.value.trim(),
      apiKey: settingApiKey.value.trim(),
    };
    await saveSettings(updated);
    Object.assign(settings, updated);
    modalBackdrop.classList.add("hidden");
    statusBar.textContent = "Settings saved";
  });

  // Generate
  btnGenerate.addEventListener("click", async () => {
    const entries = recorder.getEntries();
    if (entries.length === 0) {
      alert("No requests recorded yet.");
      return;
    }

    btnGenerate.setAttribute("disabled", "true");

    const currentSettings = await loadSettings();
    const ext = currentSettings.format === "pytest" ? "py" : "ts";

    try {
      const code = await generateTests(
        entries,
        recorder.getMarkers(),
        {
          baseUrl: extractBaseUrl(entries),
          format: currentSettings.format,
          llm: currentSettings.useLlm && currentSettings.apiKey
            ? { model: currentSettings.model, apiKey: currentSettings.apiKey }
            : undefined,
        },
        (msg) => { statusBar.textContent = msg; }
      );
      downloadFile(`test_session.${ext}`, code);
      statusBar.textContent = "Tests generated — check your Downloads";
    } catch (e) {
      statusBar.textContent = `Error: ${(e as Error).message}`;
    } finally {
      btnGenerate.removeAttribute("disabled");
    }
  });
}

function renderMarkers(container: HTMLElement, markers: { label: string }[]) {
  if (markers.length === 0) return;
  container.innerHTML = markers.map(m => `
    <div class="flow-item">
      <span class="flow-name">${m.label}</span>
      <span class="flow-meta">marker</span>
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
