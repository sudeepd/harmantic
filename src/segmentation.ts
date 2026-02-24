import type { HarEntry, FlowMarker } from "./types";

const TIME_GAP_MS = 5000;

/**
 * Split entries by user-placed markers. Each marker starts a new flow.
 * Entries before the first marker go into the first flow.
 */
export function segmentByMarkers(
  entries: HarEntry[],
  markers: FlowMarker[]
): HarEntry[][] {
  if (markers.length === 0) return [entries];

  const sorted = [...markers].sort((a, b) => a.index - b.index);
  const segments: HarEntry[][] = [];
  let prev = 0;

  for (const marker of sorted) {
    const slice = entries.slice(prev, marker.index);
    if (slice.length > 0) segments.push(slice);
    prev = marker.index;
  }
  const tail = entries.slice(prev);
  if (tail.length > 0) segments.push(tail);

  return segments;
}

/**
 * Heuristic segmentation: split on HTML document loads or large time gaps.
 */
export function segmentHeuristic(entries: HarEntry[]): HarEntry[][] {
  if (entries.length === 0) return [];

  const segments: HarEntry[][] = [];
  let current: HarEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prev = entries[i - 1];

    const isHtmlResponse = (entry.response.content.mimeType ?? "").includes("text/html");
    const timeGap = prev
      ? new Date(entry.startedDateTime).getTime() - new Date(prev.startedDateTime).getTime()
      : 0;

    if (current.length > 0 && (isHtmlResponse || timeGap > TIME_GAP_MS)) {
      segments.push(current);
      current = [];
    }
    current.push(entry);
  }

  if (current.length > 0) segments.push(current);
  return segments;
}
