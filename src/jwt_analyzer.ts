import type { Flow, CrossFlowDep } from "./types";

export interface JwtClaim {
  key: string;          // original claim key, e.g. "zs_user_id"
  value: string;        // string representation of the value
  stateKey: string;     // key used in session_state, e.g. "jwt_zs_user_id"
}

export interface JwtAnalysis {
  flowIndex: number;
  stepIndex: number;
  tokenField: string;   // response body field containing the JWT, e.g. "access_token"
  claims: JwtClaim[];
}

// Claims that are never useful as data flow values
const SKIP_CLAIMS = new Set([
  "iat", "exp", "nbf", "jti", "iss", "aud",
  "at_hash", "c_hash", "nonce", "ver", "aio",
  "azp", "azpacr", "rh", "uti",
]);

/**
 * Scan all flows for JWT tokens in response bodies.
 * Decode payloads and register all non-trivial claims into the cross-flow
 * dependency system so they participate in normal data flow detection.
 */
export function analyzeJwts(flows: Flow[]): JwtAnalysis[] {
  const analyses: JwtAnalysis[] = [];

  for (let fi = 0; fi < flows.length; fi++) {
    for (const step of flows[fi].steps) {
      const bodyText = step.entry.response.content.text;
      if (!bodyText) continue;

      let body: Record<string, unknown>;
      try { body = JSON.parse(bodyText); } catch { continue; }

      // Look for fields that look like JWTs (three dot-separated base64 segments)
      for (const [field, val] of Object.entries(body)) {
        if (typeof val !== "string" || !looksLikeJwt(val)) continue;

        const claims = decodeJwtClaims(val);
        if (claims.length === 0) continue;

        analyses.push({
          flowIndex: fi,
          stepIndex: step.index,
          tokenField: field,
          claims,
        });
      }
    }
  }

  return analyses;
}

/**
 * Inject JWT claims as cross-flow dependencies so they participate in
 * the same session_state mechanism as other cross-flow values.
 */
export function injectJwtDeps(flows: Flow[], analyses: JwtAnalysis[]): void {
  for (const analysis of analyses) {
    const { flowIndex, stepIndex, claims } = analysis;

    // For each claim value, scan later flows for usage
    for (const claim of claims) {
      for (let fi = flowIndex + 1; fi < flows.length; fi++) {
        const flow = flows[fi];
        for (const step of flow.steps) {
          const reqText = JSON.stringify(step.entry.request);
          if (!reqText.includes(claim.value)) continue;

          if (!flow.crossFlowDeps) flow.crossFlowDeps = [];
          const already = flow.crossFlowDeps.some(
            d => d.stateKey === claim.stateKey && d.consumedByStep === step.index
          );
          if (!already) {
            flow.crossFlowDeps.push({
              stateKey: claim.stateKey,
              producedByFlow: flowIndex,
              producedByStep: stepIndex,
              extractedFrom: `jwt.${claim.key}`,
              consumedByFlow: fi,
              consumedByStep: step.index,
            });
          }
        }
      }
    }
  }
}

export function decodeJwtClaims(token: string): JwtClaim[] {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return [];

    // Base64url decode
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const json = atob(payload);
    const claims = JSON.parse(json) as Record<string, unknown>;

    return Object.entries(claims)
      .filter(([key, val]) => {
        if (SKIP_CLAIMS.has(key)) return false;
        if (typeof val !== "string" && typeof val !== "number") return false;
        const str = String(val);
        return str.length >= 4 && str.length <= 256;
      })
      .map(([key, val]) => ({
        key,
        value: String(val),
        stateKey: `jwt_${key}`,
      }));
  } catch {
    return [];
  }
}

function looksLikeJwt(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts.every(p => p.length > 0 && /^[A-Za-z0-9_\-]+$/.test(p));
}
