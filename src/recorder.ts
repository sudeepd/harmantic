import type { HarEntry, FlowMarker } from "./types";

export class Recorder {
  private entries: HarEntry[] = [];
  private markers: FlowMarker[] = [];
  private _recording = false;

  get recording() { return this._recording; }
  get entryCount() { return this.entries.length; }

  start() {
    this._recording = true;
    chrome.devtools.network.onRequestFinished.addListener(this.onRequest);
  }

  stop() {
    this._recording = false;
    chrome.devtools.network.onRequestFinished.removeListener(this.onRequest);
  }

  markFlow(label: string) {
    this.markers.push({ index: this.entries.length, label });
  }

  clear() {
    this.entries = [];
    this.markers = [];
    this._recording = false;
    chrome.devtools.network.onRequestFinished.removeListener(this.onRequest);
  }

  getEntries() { return [...this.entries]; }
  getMarkers() { return [...this.markers]; }

  private onRequest = (entry: chrome.devtools.network.Request) => {
    entry.getContent((body) => {
      // Attach response body (DevTools API provides it via callback)
      const harEntry = entry as unknown as HarEntry;
      if (body) harEntry.response.content.text = body;
      this.entries.push(harEntry);
    });
  };
}
