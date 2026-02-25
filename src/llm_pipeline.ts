/**
 * LLM-powered passes for segmentation, dependency detection, and flow enrichment.
 * Navigation events from the page observer are threaded through to enrich prompts.
 */
import type { HarEntry, Step, Dependency, Flow, NavigationEvent } from "./types";
import { complete, type LlmSettings } from "./llm";
import { mergeDependencies } from "./dependencies";

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

export async function segmentWithLlm(
  entries: HarEntry[],
  heuristicSegments: HarEntry[][],
  settings: LlmSettings,
  navEvents: NavigationEvent[] = [],
  instructions?: string
): Promise<HarEntry[][]> {
  if (entries.length === 0) return heuristicSegments;

  const prompt = withInstructions(buildSegmentationPrompt(entries, navEvents), instructions);
  let text: string;
  try {
    text = await complete(prompt, settings);
  } catch (e) {
    console.warn("LLM segmentation failed, using heuristic:", e);
    return heuristicSegments;
  }

  try {
    const boundaries = parseSegmentationResponse(text, entries.length);
    if (boundaries.length === 0) return heuristicSegments;
    return applyBoundaries(entries, boundaries);
  } catch (e) {
    console.warn("LLM segmentation parse failed:", e);
    return heuristicSegments;
  }
}

function buildSegmentationPrompt(entries: HarEntry[], navEvents: NavigationEvent[]): string {
  // Build a unified timeline interleaving nav events and requests by timestamp
  type TimelineItem =
    | { kind: "nav"; t: number; event: NavigationEvent }
    | { kind: "req"; t: number; index: number; entry: HarEntry };

  const timeline: TimelineItem[] = [
    ...navEvents.map(ev => ({
      kind: "nav" as const,
      t: new Date(ev.timestamp).getTime(),
      event: ev,
    })),
    ...entries.map((entry, index) => ({
      kind: "req" as const,
      t: new Date(entry.startedDateTime).getTime(),
      index,
      entry,
    })),
  ].sort((a, b) => a.t - b.t);

  const lines = timeline.map(item => {
    if (item.kind === "nav") {
      const { pathname, title, headings } = item.event;
      const ctx = [title, ...headings].filter(Boolean).slice(0, 3).join(" | ");
      return `[NAV] → ${pathname}${ctx ? `  (${ctx})` : ""}`;
    } else {
      const url = new URL(item.entry.request.url);
      return `[${item.index}] ${item.entry.request.method} ${url.pathname} → ${item.entry.response.status}`;
    }
  }).join("\n");

  return `You are analyzing browser activity to identify logical API test case boundaries.

The timeline below interleaves page navigations [NAV] and HTTP requests [index]:

${lines}

Rules for identifying flow boundaries:
- A [NAV] event almost always signals a new test flow — the user moved to a different screen
- A new flow also starts when there is a clear semantic shift (e.g. from listing to creating a resource)
- Requests that are continuations of the same user action (e.g. follow-up GETs after a POST) belong to the same flow

Return a JSON array of the REQUEST indices (not NAV events) where new flows begin. Always include 0.
Example: [0, 5, 12]

Return ONLY the JSON array, no other text.`;
}

function parseSegmentationResponse(text: string, total: number): number[] {
  const match = text.match(/\[[\d,\s]+\]/);
  if (!match) throw new Error("No JSON array found");
  const indices: number[] = JSON.parse(match[0]);
  return indices
    .filter(i => typeof i === "number" && i >= 0 && i < total)
    .sort((a, b) => a - b);
}

function applyBoundaries(entries: HarEntry[], boundaries: number[]): HarEntry[][] {
  const segments: HarEntry[][] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1] ?? entries.length;
    const slice = entries.slice(start, end);
    if (slice.length > 0) segments.push(slice);
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Dependency detection
// ---------------------------------------------------------------------------

export async function detectDependenciesWithLlm(
  steps: Step[],
  settings: LlmSettings,
  instructions?: string
): Promise<void> {
  if (steps.length < 2) return;

  const prompt = withInstructions(buildDependencyPrompt(steps), instructions);
  let text: string;
  try {
    text = await complete(prompt, settings);
  } catch (e) {
    console.warn("LLM dependency detection failed:", e);
    return;
  }

  try {
    const deps = parseDependencyResponse(text, steps);
    mergeDependencies(steps, deps);
  } catch (e) {
    console.warn("LLM dependency parse failed:", e);
  }
}

function buildDependencyPrompt(steps: Step[]): string {
  const stepSummaries = steps.map((s, i) => {
    const url = new URL(s.entry.request.url);
    const body = s.entry.request.postData?.text?.slice(0, 200) ?? "";
    const respBody = s.entry.response.content.text?.slice(0, 300) ?? "";
    const location = s.entry.response.headers
      .find(h => h.name.toLowerCase() === "location")?.value ?? "";
    return [
      `Step ${i}: ${s.entry.request.method} ${url.pathname}`,
      body ? `  Request body: ${body}` : "",
      respBody ? `  Response: ${respBody}` : "",
      location ? `  Location header: ${location}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return `You are analyzing HTTP requests to find data dependencies between steps.

${stepSummaries}

Identify cases where a value from one step's response (body or headers) is used in a later step's request (URL, body, or headers). These are typically IDs, tokens, or resource identifiers.

Return a JSON array of dependency objects:
[
  {
    "sourceStepIndex": 0,
    "targetStepIndex": 2,
    "extractedFrom": "body.id",
    "targetKey": "url_path",
    "variableName": "step0_id"
  }
]

Only include cases where you are confident a value flows from one step to another.
Return ONLY the JSON array.`;
}

function parseDependencyResponse(text: string, steps: Step[]): Dependency[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  const raw = JSON.parse(match[0]) as Array<{
    sourceStepIndex: number;
    targetStepIndex: number;
    extractedFrom: string;
    targetKey: string;
    variableName: string;
  }>;

  return raw.filter(d =>
    typeof d.sourceStepIndex === "number" &&
    typeof d.targetStepIndex === "number" &&
    d.sourceStepIndex < d.targetStepIndex &&
    d.sourceStepIndex >= 0 &&
    d.targetStepIndex < steps.length
  ).map(d => ({
    sourceStepIndex: d.sourceStepIndex,
    targetStepIndex: d.targetStepIndex,
    extractedFrom: d.extractedFrom ?? "body",
    targetKey: d.targetKey ?? "url_path",
    variableName: d.variableName ?? `step${d.sourceStepIndex}_val`,
  }));
}

// ---------------------------------------------------------------------------
// Flow enrichment (name + assertions)
// ---------------------------------------------------------------------------

export async function enrichFlowWithLlm(
  flow: Flow,
  settings: LlmSettings,
  navContext?: NavigationEvent[],
  instructions?: string
): Promise<void> {
  const prompt = withInstructions(buildEnrichmentPrompt(flow, navContext), instructions);
  let text: string;
  try {
    text = await complete(prompt, settings);
  } catch (e) {
    console.warn("LLM enrichment failed:", e);
    return;
  }

  try {
    const result = parseEnrichmentResponse(text);
    if (result.name) flow.name = result.name;
    if (result.assertions) flow.llmAssertions = result.assertions;
  } catch (e) {
    console.warn("LLM enrichment parse failed:", e);
  }
}

function buildEnrichmentPrompt(flow: Flow, navContext?: NavigationEvent[]): string {
  const steps = flow.steps.map((s, i) => {
    const url = new URL(s.entry.request.url);
    const resp = s.entry.response.content.text?.slice(0, 200) ?? "";
    return `Step ${i}: ${s.entry.request.method} ${url.pathname} → ${s.entry.response.status}${resp ? `\n  Response: ${resp}` : ""}`;
  }).join("\n");

  const pageCtx = navContext && navContext.length > 0
    ? `\nPage context at start of flow:\n  URL: ${navContext[0].pathname}\n  Title: ${navContext[0].title}\n  Visible: ${navContext[0].headings.join(", ")}\n`
    : "";

  return `You are generating test metadata for an API test flow.
${pageCtx}
Steps:
${steps}

Return a JSON object with:
{
  "name": "short_snake_case_name_describing_what_is_tested",
  "assertions": ["assert response_0.json()['active'] == True", "assert 'id' in response_1.json()"]
}

The name should reflect what the user was doing on screen (e.g. "create_workflow", "admin_login", "view_dashboard").
Assertions should be valid Python expressions using response_N variables.
Return ONLY the JSON object.`;
}

function parseEnrichmentResponse(text: string): { name?: string; assertions?: string[] } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  const obj = JSON.parse(match[0]);
  return {
    name: typeof obj.name === "string" ? obj.name : undefined,
    assertions: Array.isArray(obj.assertions) ? obj.assertions : undefined,
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function withInstructions(prompt: string, instructions?: string): string {
  if (!instructions?.trim()) return prompt;
  return `IMPORTANT USER INSTRUCTIONS — apply these to all decisions below:\n${instructions.trim()}\n\n---\n\n${prompt}`;
}
