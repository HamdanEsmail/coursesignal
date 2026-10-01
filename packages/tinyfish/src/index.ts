import {
  tinyfishAgentRequestSchema,
  tinyfishAgentResponseSchema,
  tinyfishFetchRequestSchema,
  tinyfishFetchResponseSchema,
  tinyfishSearchRequestSchema,
  tinyfishSearchResponseSchema,
  type TinyFishAgentRequest,
  type TinyFishAgentResponse,
  type TinyFishFetchRequest,
  type TinyFishFetchResponse,
  type TinyFishSearchRequest,
  type TinyFishSearchResponse,
} from "@coursesignal/contracts";

/**
 * Secret-free boundary implemented by an application adapter. The adapter is
 * the only layer allowed to construct a TinyFish SDK client or read a key.
 */
export interface TinyFishTransport {
  search(request: TinyFishSearchRequest): Promise<TinyFishSearchResponse>;
  fetch(request: TinyFishFetchRequest): Promise<TinyFishFetchResponse>;
  agent(request: TinyFishAgentRequest): Promise<TinyFishAgentResponse>;
}

export type TinyFishTransportDelegate = {
  search(request: TinyFishSearchRequest): Promise<unknown>;
  fetch(request: TinyFishFetchRequest): Promise<unknown>;
  agent(request: TinyFishAgentRequest): Promise<unknown>;
};

/**
 * Validates both sides of the provider boundary so malformed requests cannot
 * be billed and malformed responses cannot enter evidence storage.
 */
export function createValidatedTinyFishTransport(
  delegate: TinyFishTransportDelegate,
): TinyFishTransport {
  return {
    async search(request) {
      const parsedRequest = tinyfishSearchRequestSchema.parse(request);
      return tinyfishSearchResponseSchema.parse(await delegate.search(parsedRequest));
    },
    async fetch(request) {
      const parsedRequest = tinyfishFetchRequestSchema.parse(request);
      return tinyfishFetchResponseSchema.parse(await delegate.fetch(parsedRequest));
    },
    async agent(request) {
      const parsedRequest = tinyfishAgentRequestSchema.parse(request);
      return tinyfishAgentResponseSchema.parse(await delegate.agent(parsedRequest));
    },
  };
}

export type EvidencePipelineInput = {
  query: string;
  purpose: string;
  location?: string;
  language?: string;
  maximumSources?: number;
  /** Agent is opt-in and only allowed for a known interactive public page. */
  interactiveSource?: {
    url: string;
    readOnlyGoal: string;
    maxSteps?: number;
  };
};

export type EvidencePipelineResult = {
  search: TinyFishSearchResponse;
  fetch: TinyFishFetchResponse | null;
  agent: TinyFishAgentResponse | null;
  endpointsUsed: Array<"search" | "fetch" | "agent">;
};

/**
 * Deterministic endpoint orchestration. Search discovers candidates, Fetch
 * reads them, and Agent is used only when the caller explicitly identifies a
 * public interactive source that cannot be handled by Fetch.
 */
export async function runEvidencePipeline(
  transport: TinyFishTransport,
  input: EvidencePipelineInput,
): Promise<EvidencePipelineResult> {
  const maximumSources = Math.min(Math.max(input.maximumSources ?? 5, 1), 10);
  const searchRequest: TinyFishSearchRequest = {
    query: input.query,
    purpose: input.purpose,
    limit: maximumSources,
    ...(input.location === undefined ? {} : { location: input.location }),
    ...(input.language === undefined ? {} : { language: input.language }),
  };
  const search = await transport.search(searchRequest);
  const urls = search.results.slice(0, maximumSources).map((result) => result.url);

  const fetch =
    urls.length === 0
      ? null
      : await transport.fetch({
          urls,
          purpose: input.purpose,
          format: "markdown",
          perUrlTimeoutMs: 20_000,
        });

  const hasReadableFetchEvidence =
    fetch?.results.some(
      (page) => page.status === "ok" && page.text.trim().length > 0,
    ) ?? false;
  const agent = input.interactiveSource && !hasReadableFetchEvidence
    ? await transport.agent({
        url: input.interactiveSource.url,
        goal: input.interactiveSource.readOnlyGoal,
        purpose: input.purpose,
        maxSteps: input.interactiveSource.maxSteps ?? 12,
        mode: "read_only",
      })
    : null;

  return {
    search,
    fetch,
    agent,
    endpointsUsed: [
      "search",
      ...(fetch === null ? [] : (["fetch"] as const)),
      ...(agent === null ? [] : (["agent"] as const)),
    ],
  };
}
