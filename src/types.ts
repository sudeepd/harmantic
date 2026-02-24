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
}

export type OutputFormat = "pytest" | "jest" | "playwright";

export interface GeneratorConfig {
  baseUrl: string;
  format: OutputFormat;
  llmModel?: string;
  llmApiKey?: string;
}
