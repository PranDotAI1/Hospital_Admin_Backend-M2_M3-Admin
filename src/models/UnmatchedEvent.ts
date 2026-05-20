/**
 * UnmatchedEvent — records ABDM webhook payloads that were rejected.
 *
 * Reasons for rejection:
 * - UNKNOWN_EVENT: event type not in the allowed set
 * - NO_CONSENT_MATCH: consentId/requestId doesn't match any known consent
 * - INVALID_PAYLOAD: Zod schema validation failed
 * - DUPLICATE: artefact already exists (compound index conflict)
 *
 * Documents auto-expire after 30 days (TTL index) to prevent unbounded growth.
 */

import { Schema, model, Document } from "mongoose";

export enum UnmatchedEventReason {
  UNKNOWN_EVENT = "UNKNOWN_EVENT",
  NO_CONSENT_MATCH = "NO_CONSENT_MATCH",
  INVALID_PAYLOAD = "INVALID_PAYLOAD",
  DUPLICATE = "DUPLICATE",
}

export interface IUnmatchedEvent extends Document {
  /** Classified event type (or "UNKNOWN" if unrecognized) */
  eventType: string;

  /** Why this event was not processed */
  reason: UnmatchedEventReason;

  /** Human-readable explanation */
  reasonDetail?: string;

  /** Raw payload (sanitized — no PHI, only metadata fields) */
  rawPayload: Record<string, any>;

  /** ABDM REQUEST-ID header */
  requestId?: string;

  /** Extracted consentId from the payload, if any */
  consentId?: string;

  /** Extracted artefactId, if any */
  artefactId?: string;

  /** Source IP of the request */
  sourceIp?: string;

  /** Subset of HTTP headers for debugging */
  headers?: Record<string, string>;

  /** Route path that received the event */
  routePath?: string;

  createdAt: Date;
  updatedAt: Date;
}

const UnmatchedEventSchema = new Schema<IUnmatchedEvent>(
  {
    eventType: {
      type: String,
      required: true,
      default: "UNKNOWN",
    },
    reason: {
      type: String,
      enum: Object.values(UnmatchedEventReason),
      required: true,
    },
    reasonDetail: { type: String },
    rawPayload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    requestId: { type: String },
    consentId: { type: String },
    artefactId: { type: String },
    sourceIp: { type: String },
    headers: { type: Schema.Types.Mixed },
    routePath: { type: String },
  },
  {
    timestamps: true,
    collection: "unmatched_events",
  },
);

// TTL index: auto-delete after 30 days
UnmatchedEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);

// Query index for debugging specific consents
UnmatchedEventSchema.index({ consentId: 1, createdAt: -1 });

// Query by reason for operational dashboards
UnmatchedEventSchema.index({ reason: 1, createdAt: -1 });

export const UnmatchedEventModel = model<IUnmatchedEvent>(
  "UnmatchedEvent",
  UnmatchedEventSchema,
);
