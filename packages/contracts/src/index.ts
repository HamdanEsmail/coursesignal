import { z } from "zod";

export const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");

export const opaqueReferenceSchema = z
  .string()
  .min(16)
  .max(256)
  .describe("A one-way or otherwise non-plaintext provider reference");

export const claimStateSchema = z.enum([
  "verified",
  "inferred",
  "unknown",
  "conflicting",
]);

export const endpointSchema = z.enum(["search", "fetch", "agent"]);

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
]);

export const providerOperationStateSchema = z.enum([
  "reserved",
  "started",
  "succeeded",
  "failed",
  "uncertain",
]);

export const outboxStateSchema = z.enum([
  "pending",
  "claimed",
  "sent",
  "uncertain",
  "failed",
]);

export const watchStateSchema = z.enum(["active", "paused", "expired", "deleted"]);

export const sourceReceiptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  checkedAt: z.iso.datetime(),
  endpoint: endpointSchema,
});

export const evidenceClaimSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  state: claimStateSchema,
  sourceIds: z.array(z.string().min(1)),
  observedAt: z.iso.datetime(),
});

export const researchStageSchema = z.object({
  endpoint: endpointSchema,
  label: z.string().min(1),
  detail: z.string().min(1),
  status: z.enum(["waiting", "active", "complete", "failed"]),
  observedAt: z.iso.datetime().optional(),
});

export const signalSchema = z.object({
  id: z.string().min(1),
  course: z.string().min(1),
  title: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  actions: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      detail: z.string().min(1),
      sourceLabel: z.string().min(1),
    }),
  ),
  claims: z.array(evidenceClaimSchema),
  sources: z.array(sourceReceiptSchema),
  stages: z.array(researchStageSchema),
  createdAt: z.iso.datetime(),
  checkedAt: z.iso.datetime(),
  watchState: z.enum(["off", "active", "paused", "expired"]),
});

export const inboundMessageSchema = z.object({
  eventId: z.string().min(1),
  senderKey: z.string().min(1),
  conversationKey: z.string().min(1),
  text: z.string().min(1).max(8_000),
  receivedAt: z.iso.datetime(),
});

/**
 * Provider-facing event shape. `senderKey` and `conversationKey` must already be
 * pseudonymized before crossing the durable application boundary.
 */
export const inboundEnvelopeSchema = inboundMessageSchema.extend({
  provider: z.string().min(1).max(40),
  payloadHash: sha256Schema,
});

export const outboxMessageSchema = z.object({
  id: z.string().min(1),
  conversationKey: z.string().min(1),
  logicalKey: z.string().min(1),
  body: z.string().min(1).max(4_000),
  state: outboxStateSchema,
  providerMessageId: z.string().min(1).optional(),
});

export const tinyfishSearchRequestSchema = z.object({
  query: z.string().min(1).max(2_000),
  purpose: z.string().min(1).max(1_000),
  location: z.string().length(2).optional(),
  language: z.string().min(2).max(12).optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

export const tinyfishSearchHitSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
  snippet: z.string(),
  rank: z.number().int().positive(),
});

export const tinyfishSearchResponseSchema = z.object({
  results: z.array(tinyfishSearchHitSchema),
  requestId: z.string().min(1).optional(),
});

export const tinyfishFetchRequestSchema = z.object({
  urls: z.array(z.url()).min(1).max(10),
  purpose: z.string().min(1).max(1_000),
  format: z.enum(["markdown", "text"]).default("markdown"),
  perUrlTimeoutMs: z.number().int().min(1_000).max(60_000).default(20_000),
});

export const tinyfishFetchedPageSchema = z.object({
  url: z.url(),
  title: z.string().min(1),
  text: z.string(),
  contentHash: sha256Schema,
  checkedAt: z.iso.datetime(),
  status: z.enum(["ok", "unreadable", "failed"]),
});

export const tinyfishFetchResponseSchema = z.object({
  results: z.array(tinyfishFetchedPageSchema),
  requestId: z.string().min(1).optional(),
});

export const tinyfishAgentRequestSchema = z.object({
  url: z.url(),
  goal: z.string().min(1).max(4_000),
  purpose: z.string().min(1).max(1_000),
  maxSteps: z.number().int().min(1).max(50).default(12),
  /** Mutating goals are intentionally not part of the contract. */
  mode: z.literal("read_only").default("read_only"),
});

export const tinyfishAgentResponseSchema = z.object({
  url: z.url(),
  summary: z.string(),
  extractedText: z.string(),
  contentHash: sha256Schema,
  checkedAt: z.iso.datetime(),
  stepsUsed: z.number().int().nonnegative(),
  requestId: z.string().min(1).optional(),
});

export type ClaimState = z.infer<typeof claimStateSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type ProviderOperationState = z.infer<typeof providerOperationStateSchema>;
export type OutboxState = z.infer<typeof outboxStateSchema>;
export type WatchState = z.infer<typeof watchStateSchema>;
export type SourceReceipt = z.infer<typeof sourceReceiptSchema>;
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;
export type ResearchStage = z.infer<typeof researchStageSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type InboundMessage = z.infer<typeof inboundMessageSchema>;
export type InboundEnvelope = z.infer<typeof inboundEnvelopeSchema>;
export type OutboxMessage = z.infer<typeof outboxMessageSchema>;
export type TinyFishSearchRequest = z.infer<typeof tinyfishSearchRequestSchema>;
export type TinyFishSearchHit = z.infer<typeof tinyfishSearchHitSchema>;
export type TinyFishSearchResponse = z.infer<typeof tinyfishSearchResponseSchema>;
export type TinyFishFetchRequest = z.infer<typeof tinyfishFetchRequestSchema>;
export type TinyFishFetchedPage = z.infer<typeof tinyfishFetchedPageSchema>;
export type TinyFishFetchResponse = z.infer<typeof tinyfishFetchResponseSchema>;
export type TinyFishAgentRequest = z.infer<typeof tinyfishAgentRequestSchema>;
export type TinyFishAgentResponse = z.infer<typeof tinyfishAgentResponseSchema>;
