/**
 * The AI provider port — the single external-dependency seam.
 *
 * Every non-deterministic intelligent call leaves the domain through here, so
 * that real and fake implementations are interchangeable and the domain's tests
 * are fully deterministic. Ticket 01 needs only `respond`: extraction into
 * terms, embeddings, and link judging arrive with their own tickets.
 *
 * The real implementation talks to a cloud LLM; the fake one is scripted by the
 * test. The domain never learns which it got.
 *
 * @module domain/ai-provider
 */

/** What the provider is asked to say something about. */
export interface RespondRequest {
  /** The drop's original text. */
  readonly body: string;
}

/** The provider's answer to one drop. */
export interface RespondResult {
  /** The reply text. The domain validates it against the parent-voice rules. */
  readonly reply: string;
}

/**
 * The port. Implementations live outside the domain core — the domain holds the
 * interface, never a concrete provider.
 */
export interface AiProvider {
  /**
   * Compose the reply to one drop.
   *
   * Implementations may throw or take their time; the domain treats both as
   * ordinary, because a drop succeeds whether or not the provider answers.
   *
   * @param request - the drop being answered.
   * @returns the reply text.
   */
  respond(request: RespondRequest): Promise<RespondResult>;
}
