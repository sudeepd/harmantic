import type { HarEntry, FlowMarker, Flow, Step, GeneratorConfig, NavigationEvent } from "./types";
import { segmentByMarkers, segmentHeuristic } from "./segmentation";
import { detectDependencies } from "./dependencies";
import { segmentWithLlm, detectDependenciesWithLlm, enrichFlowWithLlm } from "./llm_pipeline";
import { renderPytest } from "./renderers/pytest";
import { renderJest } from "./renderers/jest";

export async function generateTests(
  entries: HarEntry[],
  markers: FlowMarker[],
  config: GeneratorConfig,
  onProgress?: (msg: string) => void
): Promise<string> {
  const log = onProgress ?? (() => {});

  // 1. Filter noise
  log("Filtering requests…");
  const filtered = filterEntries(entries);

  if (!config.llm) throw new Error("LLM config required — set your API key in Settings (⚙)");

  // 2. Segment into flows
  log("Segmenting flows…");
  const heuristic = markers.length > 0
    ? segmentByMarkers(filtered, markers)
    : segmentHeuristic(filtered);

  // Use LLM segmentation only when no user markers provided
  const segments = markers.length === 0
    ? await segmentWithLlm(filtered, heuristic, config.llm, config.navEvents)
    : heuristic;

  // 3. Build flows with heuristic dependency detection
  log("Detecting dependencies…");
  const flows: Flow[] = segments.map((seg, i) => {
    const steps: Step[] = seg.map((entry, j) => ({ index: j, entry, dependencies: [] }));
    detectDependencies(steps);
    return {
      name: markers[i]?.label ?? `flow_${i + 1}`,
      steps,
      requiresAuth: steps.some(s =>
        s.entry.request.headers.some(h => h.name.toLowerCase() === "authorization")
      ),
    };
  });

  // 4. LLM passes: dependency detection + enrichment
  // Associate nav events with each flow by timestamp
  const flowStartTimes = flows.map(f =>
    new Date(f.steps[0]?.entry.startedDateTime ?? 0).getTime()
  );

  for (let i = 0; i < flows.length; i++) {
    log(`LLM enriching flow ${i + 1}/${flows.length}…`);
    await detectDependenciesWithLlm(flows[i].steps, config.llm);

    // Nav events that occurred before the next flow starts
    const flowStart = flowStartTimes[i];
    const flowEnd = flowStartTimes[i + 1] ?? Infinity;
    const flowNav = config.navEvents.filter(ev => {
      const t = new Date(ev.timestamp).getTime();
      return t >= flowStart - 2000 && t < flowEnd;
    });

    await enrichFlowWithLlm(flows[i], config.llm, flowNav);
  }

  // 5. Render
  log("Rendering test file…");
  switch (config.format) {
    case "jest":
    case "playwright":
      return renderJest(flows, config);
    case "pytest":
    default:
      return renderPytest(flows, config);
  }
}

function filterEntries(entries: HarEntry[]): HarEntry[] {
  const NOISE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)(\?.*)?$/i;
  const NOISE_DOMAINS = /google-analytics|googletagmanager|hotjar|intercom|segment\.io/i;

  return entries.filter(e => {
    const url = e.request.url;
    if (NOISE_EXTENSIONS.test(url)) return false;
    if (NOISE_DOMAINS.test(url)) return false;
    // Drop pure static asset fetches (CSS/JS) only if they have no interesting status
    const isCssJs = /\.(css|js)(\?.*)?$/.test(url);
    if (isCssJs && e.response.status === 200) return false;
    return true;
  });
}
