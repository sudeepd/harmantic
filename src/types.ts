export interface NavigationEvent {
  timestamp: string;        // ISO
  url: string;
  pathname: string;
  title: string;
  headings: string[];       // h1/h2/h3 text visible at that moment
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    headers: Array<{ name: string; value: string }>;
    content: { mimeType: string; text?: string };
  };
}

export interface FlowMarker {
  index: number;      // entry index where marker was dropped
  label: string;
}

export interface Dependency {
  sourceStepIndex: number;
  targetStepIndex: number;
  targetKey: string;
  extractedFrom: string;  // e.g. "response.body.id" or "header.Location"
  variableName: string;
}

export interface Step {
  index: number;
  entry: HarEntry;
  dependencies: Dependency[];
}

export interface Flow {
  name: string;
  steps: Step[];
  requiresAuth: boolean;
  llmAssertions?: string[];
}

export type OutputFormat = "pytest" | "jest" | "playwright";

export interface GeneratorConfig {
  baseUrl: string;
  format: OutputFormat;
  navEvents: NavigationEvent[];
  llm?: {
    model: string;
    apiKey: string;
  };
}
