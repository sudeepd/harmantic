export interface LlmSettings {
  model: string;      // e.g. "anthropic/claude-sonnet-4-20250514" or "openai/gpt-4o"
  apiKey: string;
}

/**
 * Send a prompt to the configured LLM and return the response text.
 * Supports anthropic/* and openai/* model prefixes.
 */
export async function complete(prompt: string, settings: LlmSettings): Promise<string> {
  const slash = settings.model.indexOf("/");
  if (slash === -1) throw new Error(`Model must be "vendor/model", got: ${settings.model}`);
  const vendor = settings.model.slice(0, slash);
  const model = settings.model.slice(slash + 1);

  switch (vendor) {
    case "anthropic": return callAnthropic(prompt, model, settings.apiKey);
    case "openai":    return callOpenAI(prompt, model, settings.apiKey);
    default: throw new Error(`Unsupported vendor: ${vendor}. Use "anthropic" or "openai".`);
  }
}

async function callAnthropic(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? "";
}

async function callOpenAI(prompt: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? "";
}
