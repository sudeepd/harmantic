import type { Recorder } from "./recorder";
import { generateTests } from "./generator";

export function renderPanel(root: HTMLElement, recorder: Recorder) {
  root.innerHTML = `
    <div class="toolbar">
      <button class="btn primary" id="btn-record">Start Recording</button>
      <button class="btn" id="btn-mark">Mark Flow</button>
      <button class="btn" id="btn-clear">Clear</button>
      <span class="badge" id="badge-count">0 requests</span>
      <div style="flex:1"></div>
      <button class="btn primary" id="btn-generate">Generate Tests</button>
    </div>
    <div class="flow-list" id="flow-list">
      <div class="empty-state">
        <div>Press <strong>Start Recording</strong> then use your app</div>
        <div>Press <strong>Mark Flow</strong> to separate test cases</div>
      </div>
    </div>
    <div class="status-bar" id="status-bar">Ready</div>
  `;

  const btnRecord = document.getElementById("btn-record")!;
  const btnMark = document.getElementById("btn-mark")!;
  const btnClear = document.getElementById("btn-clear")!;
  const btnGenerate = document.getElementById("btn-generate")!;
  const badgeCount = document.getElementById("badge-count")!;
  const statusBar = document.getElementById("status-bar")!;
  const flowList = document.getElementById("flow-list")!;

  // Poll for entry count updates
  setInterval(() => {
    badgeCount.textContent = `${recorder.entryCount} requests`;
  }, 500);

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

  btnMark.addEventListener("click", () => {
    const label = prompt("Flow name:", `flow_${recorder.getMarkers().length + 1}`);
    if (!label) return;
    recorder.markFlow(label);
    renderMarkers(flowList, recorder.getMarkers());
    statusBar.textContent = `Marker added: ${label}`;
  });

  btnClear.addEventListener("click", () => {
    if (!confirm("Clear all recorded requests and markers?")) return;
    recorder.clear();
    flowList.innerHTML = `<div class="empty-state">
      <div>Press <strong>Start Recording</strong> then use your app</div>
    </div>`;
    statusBar.textContent = "Cleared";
  });

  btnGenerate.addEventListener("click", async () => {
    const entries = recorder.getEntries();
    if (entries.length === 0) {
      alert("No requests recorded yet.");
      return;
    }
    statusBar.textContent = "Generating tests…";
    btnGenerate.setAttribute("disabled", "true");

    try {
      const code = await generateTests(entries, recorder.getMarkers(), {
        baseUrl: extractBaseUrl(entries),
        format: "pytest",
      });
      downloadFile("test_session.py", code);
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

function extractBaseUrl(entries: { request: { url: string } }[]) {
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
