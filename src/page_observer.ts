import type { NavigationEvent } from "./types";

/**
 * Observes the inspected page for navigation events and DOM context.
 * Uses chrome.devtools.inspectedWindow.eval to inject a lightweight listener
 * into the page, then polls for collected events.
 */
export class PageObserver {
  private events: NavigationEvent[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    // Inject navigation listener into the page (idempotent)
    await evalInPage(`
      if (!window.__harmantic) {
        window.__harmantic = { navQueue: [] };

        function __hCapture() {
          window.__harmantic.navQueue.push({
            timestamp: new Date().toISOString(),
            url: location.href,
            pathname: location.pathname,
            title: document.title,
            headings: Array.from(document.querySelectorAll('h1,h2,h3,nav a.active,[aria-current="page"]'))
              .map(el => el.textContent?.trim())
              .filter(Boolean)
              .slice(0, 10)
          });
        }

        const _push = history.pushState.bind(history);
        const _replace = history.replaceState.bind(history);

        history.pushState = function(...args) {
          _push(...args);
          setTimeout(__hCapture, 50); // let the framework update the DOM first
        };
        history.replaceState = function(...args) {
          _replace(...args);
          setTimeout(__hCapture, 50);
        };

        window.addEventListener('popstate', () => setTimeout(__hCapture, 50));

        // Capture initial state
        __hCapture();
      }
    `);

    // Poll every 600ms — drain the queue from the page
    this.pollTimer = setInterval(() => this.poll(), 600);
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  clear(): void {
    this.stop();
    this.events = [];
    // Reset page-side queue too
    evalInPage(`if (window.__harmantic) window.__harmantic.navQueue = [];`).catch(() => {});
  }

  getEvents(): NavigationEvent[] {
    return [...this.events];
  }

  private async poll(): Promise<void> {
    try {
      const json = await evalInPage<string>(
        `JSON.stringify(window.__harmantic ? window.__harmantic.navQueue.splice(0) : [])`
      );
      const batch: NavigationEvent[] = JSON.parse(json ?? "[]");
      this.events.push(...batch);
    } catch {
      // Page navigated away or eval failed — not critical
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: promisify chrome.devtools.inspectedWindow.eval
// ---------------------------------------------------------------------------

function evalInPage<T = void>(expression: string): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval(
      expression,
      (result, exceptionInfo) => {
        if (exceptionInfo?.isException || exceptionInfo?.isError) {
          reject(new Error(exceptionInfo.value ?? "eval error"));
        } else {
          resolve(result as T);
        }
      }
    );
  });
}
