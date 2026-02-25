import type { HarEntry, Step, Dependency } from "./types";

const MIN_ID_LENGTH = 6;

/**
 * Heuristic dependency detection: find response values that appear in later requests.
 * Mirrors the Python flow_analyzer logic.
 */
export function detectDependencies(steps: Step[]): void {
  const registry = new Map<string, { stepIndex: number; path: string }>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const entry = step.entry;

    const reqText = JSON.stringify(entry.request);
    for (const [value, source] of registry.entries()) {
      if (source.stepIndex >= i) continue;
      if (reqText.includes(value)) {
        const dep: Dependency = {
          sourceStepIndex: source.stepIndex,
          targetStepIndex: i,
          targetKey: inferTargetKey(entry, value),
          extractedFrom: source.path,
          variableName: pathToVarName(source.path, source.stepIndex),
        };
        const key = `${dep.sourceStepIndex}:${dep.targetStepIndex}:${dep.targetKey}`;
        if (!step.dependencies.some(d => `${d.sourceStepIndex}:${d.targetStepIndex}:${d.targetKey}` === key)) {
          step.dependencies.push(dep);
        }
      }
    }

    collectResponseValues(entry, i, registry);
  }
}

/**
 * Merge LLM-detected dependencies into existing heuristic ones, deduplicating.
 */
export function mergeDependencies(steps: Step[], llmDeps: Dependency[]): void {
  for (const dep of llmDeps) {
    const target = steps[dep.targetStepIndex];
    if (!target) continue;
    const key = `${dep.sourceStepIndex}:${dep.targetStepIndex}:${dep.targetKey}`;
    if (!target.dependencies.some(d => `${d.sourceStepIndex}:${d.targetStepIndex}:${d.targetKey}` === key)) {
      target.dependencies.push(dep);
    }
  }
}

function collectResponseValues(
  entry: HarEntry,
  stepIndex: number,
  registry: Map<string, { stepIndex: number; path: string }>
) {
  for (const h of entry.response.headers) {
    if (h.name.toLowerCase() === "location" && h.value) {
      const segment = h.value.replace(/\/$/, "").split("/").pop() ?? "";
      if (segment.length >= MIN_ID_LENGTH && looksLikeId(segment)) {
        registry.set(segment, { stepIndex, path: "header.Location" });
      }
    }
  }

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
  for (const part of entry.request.url.split("/")) {
    if (part === value) return "url_path";
  }
  return "body";
}

function pathToVarName(path: string, stepIndex: number): string {
  const base = path
    .replace(/^header\./, "header_")
    .replace(/[.[\]]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `step${stepIndex}_${base}`;
}
