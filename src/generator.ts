import type { HarEntry, FlowMarker, Flow, Step, GeneratorConfig } from "./types";
import { segmentByMarkers, segmentHeuristic } from "./segmentation";
import { detectDependencies } from "./dependencies";
import { renderPytest } from "./renderers/pytest";
import { renderJest } from "./renderers/jest";

export async function generateTests(
  entries: HarEntry[],
  markers: FlowMarker[],
  config: GeneratorConfig
): Promise<string> {
  // 1. Filter noise (images, fonts, analytics, etc.)
  const filtered = filterEntries(entries);

  // 2. Segment into flows
  const segments = markers.length > 0
    ? segmentByMarkers(filtered, markers)
    : segmentHeuristic(filtered);

  // 3. Build flows with dependency detection
  const flows: Flow[] = segments.map((entries, i) => {
    const steps: Step[] = entries.map((entry, j) => ({
      index: j,
      entry,
      dependencies: [],
    }));
    detectDependencies(steps);
    return {
      name: markers[i]?.label ?? `flow_${i + 1}`,
      steps,
      requiresAuth: steps.some(s =>
        s.entry.request.headers.some(h =>
          h.name.toLowerCase() === "authorization"
        )
      ),
    };
  });

  // 4. Render
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
  const NOISE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|css|js|map)$/i;
  const NOISE_DOMAINS = /google-analytics|googletagmanager|hotjar|intercom|segment\.io/i;
  const API_CONTENT_TYPES = /json|xml|form/i;

  return entries.filter(e => {
    const url = e.request.url;
    if (NOISE_EXTENSIONS.test(url)) return false;
    if (NOISE_DOMAINS.test(url)) return false;
    const ct = e.response.content.mimeType ?? "";
    const reqCt = e.request.postData?.mimeType ?? "";
    // Keep if response or request looks like API traffic, or status is interesting
    return API_CONTENT_TYPES.test(ct) || API_CONTENT_TYPES.test(reqCt)
      || e.response.status >= 200;
  });
}
