import type { Step, Dependency } from "./types";

const MIN_ID_LENGTH = 6;

/**
 * Heuristic dependency detection: find response values that appear in later requests.
 * Mirrors the Python flow_analyzer logic.
 */
export function detectDependencies(steps: Step[]): void {
  // Registry: value -> (stepIndex, jsonPath)
  const registry = new Map<string, { stepIndex: number; path: string }>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const entry = step.entry;

    // Check if any registry value appears in this request
    const reqText = JSON.stringify(entry.request);
    for (const [value, source] of registry.entries()) {
      if (source.stepIndex >= i) continue;
      if (reqText.includes(value)) {
        step.dependencies.push({
          sourceStepIndex: source.stepIndex,
          targetStepIndex: i,
          targetKey: inferTargetKey(entry, value),
          extractedFrom: source.path,
          variableName: pathToVarName(source.path, source.stepIndex),
        });
      }
    }

    // Register values from this response
    collectResponseValues(entry, i, registry);
  }
}

function collectResponseValues(
  entry: HarEntry,
  stepIndex: number,
  registry: Map<string, { stepIndex: number; path: string }>
) {
  // Location header (e.g. 201 Created)
  for (const h of entry.response.headers) {
    if (h.name.toLowerCase() === "location" && h.value) {
      const segment = h.value.replace(/\/$/, "").split("/").pop() ?? "";
      if (segment.length >= MIN_ID_LENGTH && looksLikeId(segment)) {
        registry.set(segment, { stepIndex, path: "header.Location" });
      }
    }
  }

  // Response body JSON fields
  const bodyText = entry.response.content.text;
  if (!bodyText) return;
  try {
    const body = JSON.parse(bodyText);
    collectJsonValues(body, "", stepIndex, registry);
  } catch { /* not JSON */ }
}

function collectJsonValues(
  obj: unknown,
  path: string,
  stepIndex: number,
  registry: Map<string, { stepIndex: number; path: string }>,
  depth = 0
) {
  if (depth > 4 || obj === null || obj === undefined) return;
  if (typeof obj === "string") {
    if (obj.length >= MIN_ID_LENGTH && looksLikeId(obj)) {
      registry.set(obj, { stepIndex, path });
    }
    return;
  }
  if (typeof obj === "number") {
    const s = String(obj);
    if (s.length >= MIN_ID_LENGTH) registry.set(s, { stepIndex, path });
    return;
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 5).forEach((v, i) =>
      collectJsonValues(v, `${path}[${i}]`, stepIndex, registry, depth + 1)
    );
    return;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      collectJsonValues(v, path ? `${path}.${k}` : k, stepIndex, registry, depth + 1);
    }
  }
}

function looksLikeId(value: string): boolean {
  return /[\d\-]/.test(value);
}

function inferTargetKey(entry: HarEntry, value: string): string {
  // Try to find which part of the URL or body contains the value
  const url = entry.request.url;
  const urlParts = url.split("/");
  for (const part of urlParts) {
    if (part === value) return "url_path";
  }
  return "body";
}

function pathToVarName(path: string, stepIndex: number): string {
  const base = path
    .replace(/^header\./, "header_")
    .replace(/[.\[\]]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `step${stepIndex}_${base}`;
}

// Re-export HarEntry type for internal use
import type { HarEntry } from "./types";
