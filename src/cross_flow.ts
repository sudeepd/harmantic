import type { Flow, CrossFlowDep, HarEntry } from "./types";

const MIN_ID_LENGTH = 6;

/**
 * Detect dependencies between flows — values produced by one flow's responses
 * that appear in a later flow's requests. Populates flow.crossFlowDeps.
 */
export function detectCrossFlowDeps(flows: Flow[]): void {
  // Build registry of all values produced across all flows
  // registry: value -> { flowIndex, stepIndex, extractedFrom, stateKey }
  const registry = new Map<string, {
    flowIndex: number;
    stepIndex: number;
    extractedFrom: string;
    stateKey: string;
  }>();

  // First pass: collect all response values
  for (let fi = 0; fi < flows.length; fi++) {
    for (const step of flows[fi].steps) {
      collectResponseValues(step.entry, fi, step.index, flows[fi].name, registry);
    }
  }

  // Second pass: check each flow's requests against the registry
  for (let fi = 0; fi < flows.length; fi++) {
    const flow = flows[fi];
    flow.crossFlowDeps = [];

    for (const step of flow.steps) {
      const reqText = JSON.stringify(step.entry.request);

      for (const [value, source] of registry.entries()) {
        // Only look at values produced by earlier flows
        if (source.flowIndex >= fi) continue;

        if (reqText.includes(value)) {
          const already = flow.crossFlowDeps.some(
            d => d.stateKey === source.stateKey && d.consumedByStep === step.index
          );
          if (!already) {
            flow.crossFlowDeps.push({
              stateKey: source.stateKey,
              producedByFlow: source.flowIndex,
              producedByStep: source.stepIndex,
              extractedFrom: source.extractedFrom,
              consumedByFlow: fi,
              consumedByStep: step.index,
            });
          }
        }
      }
    }
  }
}

function collectResponseValues(
  entry: HarEntry,
  flowIndex: number,
  stepIndex: number,
  flowName: string,
  registry: Map<string, { flowIndex: number; stepIndex: number; extractedFrom: string; stateKey: string }>
) {
  // Location header
  for (const h of entry.response.headers) {
    if (h.name.toLowerCase() === "location" && h.value) {
      const segment = h.value.replace(/\/$/, "").split("/").pop() ?? "";
      if (segment.length >= MIN_ID_LENGTH && looksLikeId(segment)) {
        const stateKey = `${sanitize(flowName)}_id`;
        registry.set(segment, { flowIndex, stepIndex, extractedFrom: "header.Location", stateKey });
      }
    }
  }

  // Response body
  const bodyText = entry.response.content.text;
  if (!bodyText) return;
  try {
    collectJsonValues(JSON.parse(bodyText), "", flowIndex, stepIndex, flowName, registry);
  } catch { /* not JSON */ }
}

function collectJsonValues(
  obj: unknown,
  path: string,
  flowIndex: number,
  stepIndex: number,
  flowName: string,
  registry: Map<string, { flowIndex: number; stepIndex: number; extractedFrom: string; stateKey: string }>,
  depth = 0
) {
  if (depth > 4 || obj === null || obj === undefined) return;

  if (typeof obj === "string") {
    if (obj.length >= MIN_ID_LENGTH && looksLikeId(obj)) {
      const fieldName = path.split(".").pop() ?? "val";
      const stateKey = `${sanitize(flowName)}_${sanitize(fieldName)}`;
      registry.set(obj, { flowIndex, stepIndex, extractedFrom: `body.${path}`, stateKey });
    }
    return;
  }
  if (typeof obj === "number") {
    const s = String(obj);
    if (s.length >= MIN_ID_LENGTH) {
      const fieldName = path.split(".").pop() ?? "val";
      registry.set(s, {
        flowIndex, stepIndex,
        extractedFrom: `body.${path}`,
        stateKey: `${sanitize(flowName)}_${sanitize(fieldName)}`,
      });
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.slice(0, 3).forEach((v, i) =>
      collectJsonValues(v, `${path}[${i}]`, flowIndex, stepIndex, flowName, registry, depth + 1)
    );
    return;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      collectJsonValues(v, path ? `${path}.${k}` : k, flowIndex, stepIndex, flowName, registry, depth + 1);
    }
  }
}

function looksLikeId(value: string): boolean {
  return /[\d\-]/.test(value);
}

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
