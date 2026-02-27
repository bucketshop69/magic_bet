import type { Logger } from "pino";

export interface TapestryConfig {
  apiKey: string | undefined;
  namespace: string;
  log: Logger;
}

export class TapestryClient {
  private readonly baseUrl = "https://api.usetapestry.dev/api/v1";

  constructor(public readonly config: TapestryConfig) {}

  get isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.namespace);
  }

  async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    if (!this.config.apiKey) {
      this.config.log.debug(
        { endpoint },
        "tapestry api key missing, skipping api call"
      );
      return null;
    }

    const upstreamUrl = new URL(`${this.baseUrl}${endpoint}`);
    upstreamUrl.searchParams.set("apiKey", this.config.apiKey);
    const url = upstreamUrl.toString();
    const logUrl = `${upstreamUrl.origin}${upstreamUrl.pathname}`;
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      ...(options.headers || {}),
    };

    try {
      // @ts-ignore fetch is available in Node > 18
      const resp = await fetch(url, { ...options, headers });
      if (!resp.ok) {
        const text = await resp.text();
        this.config.log.warn(
          { url: logUrl, status: resp.status, response: text },
          "tapestry api error (non-blocking)"
        );
        return null;
      }
      return await resp.json();
    } catch (err: any) {
      this.config.log.error(
        { url: logUrl, err: err.message },
        "tapestry network error (non-blocking)"
      );
      return null;
    }
  }
}
