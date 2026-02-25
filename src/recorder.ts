import type { HarEntry, FlowMarker, NavigationEvent } from "./types";
import { PageObserver } from "./page_observer";

export class Recorder {
  private entries: HarEntry[] = [];
  private markers: FlowMarker[] = [];
  private _recording = false;
  private pageObserver = new PageObserver();

  get recording() { return this._recording; }
  get entryCount() { return this.entries.length; }

  async start(): Promise<void> {
    this._recording = true;
    chrome.devtools.network.onRequestFinished.addListener(this.onRequest);
    await this.pageObserver.start();
  }

  stop(): void {
    this._recording = false;
    chrome.devtools.network.onRequestFinished.removeListener(this.onRequest);
    this.pageObserver.stop();
  }

  markFlow(label: string): void {
    this.markers.push({ index: this.entries.length, label });
  }

  clear(): void {
    this.entries = [];
    this.markers = [];
    this._recording = false;
    chrome.devtools.network.onRequestFinished.removeListener(this.onRequest);
    this.pageObserver.clear();
  }

  getEntries(): HarEntry[] { return [...this.entries]; }
  getMarkers(): FlowMarker[] { return [...this.markers]; }
  getNavEvents(): NavigationEvent[] { return this.pageObserver.getEvents(); }

  private onRequest = (entry: chrome.devtools.network.Request): void => {
    entry.getContent((body) => {
      const harEntry = entry as unknown as HarEntry;
      if (body) harEntry.response.content.text = body;
      this.entries.push(harEntry);
    });
  };
}
