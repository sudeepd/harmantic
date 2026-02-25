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
  notes?: string;     // per-flow instructions to the LLM
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

// A value produced by one flow and consumed by another
export interface CrossFlowDep {
  stateKey: string;           // key in session_state dict, e.g. "workflow_id"
  producedByFlow: number;     // flow index
  producedByStep: number;     // step index within that flow
  extractedFrom: string;      // e.g. "header.Location" or "body.id"
  consumedByFlow: number;     // flow index
  consumedByStep: number;     // step index within that flow
}

export interface Flow {
  name: string;
  notes?: string;             // per-flow LLM instructions from the user
  steps: Step[];
  requiresAuth: boolean;
  llmAssertions?: string[];
  crossFlowDeps?: CrossFlowDep[];  // deps on other flows (populated after all flows built)
}

export type OutputFormat = "pytest" | "jest" | "playwright";

export interface GeneratorConfig {
  baseUrl: string;
  format: OutputFormat;
  navEvents: NavigationEvent[];
  parseJwt: boolean;
  jwtAnalyses?: import("./jwt_analyzer").JwtAnalysis[];
  llm?: {
    model: string;
    apiKey: string;
  };
}
