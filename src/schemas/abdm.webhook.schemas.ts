/**
 * Zod schemas for ABDM webhook payload validation.
 *
 * Every inbound ABDM callback is validated against these schemas before processing.
 * Invalid payloads are rejected early and logged to UnmatchedEvent.
 */

import { z } from "zod";

// ============================================================================
// Shared sub-schemas
// ============================================================================

const KeyMaterialSchema = z.object({
  cryptoAlg: z.string().optional(),
  curve: z.string().optional(),
  dhPublicKey: z.object({
    expiry: z.string().optional(),
    parameters: z.string().optional(),
    keyValue: z.string().min(1, "dhPublicKey.keyValue is required"),
  }),
  nonce: z.string().min(1, "nonce is required"),
});

const DateRangeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const ResponseRefSchema = z.object({
  requestId: z.string().optional(),
}).optional();

// ============================================================================
// 1. Health Information Request — POST /api/v3/hip/health-information/request
// ============================================================================

export const HealthInformationRequestSchema = z.object({
  transactionId: z.string().min(1, "transactionId is required"),
  requestId: z.string().optional(),
  hiRequest: z.object({
    consent: z.object({
      id: z.string().min(1, "consent.id is required"),
    }),
    dateRange: DateRangeSchema,
    dataPushUrl: z.string().url("dataPushUrl must be a valid URL"),
    keyMaterial: KeyMaterialSchema,
  }),
});

export type HealthInformationRequestPayload = z.infer<typeof HealthInformationRequestSchema>;

// ============================================================================
// 2. Consent HIP Notify — POST /api/v3/consent/request/hip/notify
// ============================================================================

const ConsentArtefactRefSchema = z.object({
  id: z.string().min(1),
});

const ConsentDetailInlineSchema = z.object({
  consentId: z.string().optional(),
  purpose: z.object({
    code: z.string().optional(),
    text: z.string().optional(),
    refUri: z.string().optional(),
  }).optional(),
  careContexts: z.array(z.object({
    patientReference: z.string().optional(),
    careContextReference: z.string().optional(),
  })).optional(),
  hip: z.object({ id: z.string().optional() }).optional(),
  hiu: z.object({ id: z.string().optional() }).optional(),
  hiTypes: z.array(z.string()).optional(),
  permission: z.object({
    accessMode: z.string().optional(),
    dateRange: z.object({
      from: z.string().optional(),
      to: z.string().optional(),
    }).optional(),
    dataEraseAt: z.string().optional(),
    frequency: z.object({
      unit: z.string().optional(),
      value: z.number().optional(),
      repeats: z.number().optional(),
    }).optional(),
  }).optional(),
  patient: z.object({
    id: z.string().optional(),
  }).optional(),
  requester: z.object({
    name: z.string().optional(),
    identifier: z.object({
      type: z.string().optional(),
      value: z.string().optional(),
      system: z.string().optional(),
    }).optional(),
  }).optional(),
  signature: z.string().optional(),
}).passthrough(); // ABDM may add additional fields

export const ConsentNotifySchema = z.object({
  timestamp: z.string().optional(),
  requestId: z.string().optional(),
  notification: z.object({
    status: z.enum(["GRANTED", "REVOKED", "DENIED", "EXPIRED"], {
      error: "notification.status must be GRANTED, REVOKED, DENIED, or EXPIRED",
    }),
    consentRequestId: z.string().optional(),
    consentId: z.string().optional(),
    consentArtefacts: z.array(ConsentArtefactRefSchema).optional(),
    consentDetail: ConsentDetailInlineSchema.optional(),
    timestamp: z.string().optional(),
  }),
  response: ResponseRefSchema,
});

export type ConsentNotifyPayload = z.infer<typeof ConsentNotifySchema>;

// ============================================================================
// 3. HIU Health Information Transfer — POST /api/v3/hiu/health-information/transfer
// ============================================================================

const TransferEntrySchema = z.object({
  content: z.string().min(1, "entry.content is required"),
  media: z.string().optional(),
  checksum: z.string().optional(),
  careContextReference: z.string().min(1, "entry.careContextReference is required"),
});

export const HiuTransferSchema = z.object({
  pageNumber: z.number().optional(),
  pageCount: z.number().optional(),
  transactionId: z.string().min(1, "transactionId is required"),
  entries: z.array(TransferEntrySchema).min(1, "entries must not be empty"),
  keyMaterial: KeyMaterialSchema,
});

export type HiuTransferPayload = z.infer<typeof HiuTransferSchema>;

// ============================================================================
// 4. Consent On-Fetch — POST /api/v3/hiu/consent/on-fetch
// ============================================================================

export const ConsentOnFetchSchema = z.object({
  error: z.any().optional(),
  consent: z.object({
    id: z.string().optional(),
    status: z.string().optional(),
    consentDetail: z.object({
      consentId: z.string().optional(),
      consentRequestId: z.string().optional(),
      purpose: z.object({ code: z.string().optional(), text: z.string().optional() }).optional(),
      careContexts: z.array(z.any()).optional(),
      hip: z.object({ id: z.string().optional() }).optional(),
      hiu: z.object({ id: z.string().optional() }).optional(),
      hiTypes: z.array(z.string()).optional(),
      permission: z.any().optional(),
      patient: z.any().optional(),
      requester: z.any().optional(),
    }).passthrough().optional(),
    signature: z.string().optional(),
  }).optional(),
  response: ResponseRefSchema,
}).passthrough();

export type ConsentOnFetchPayload = z.infer<typeof ConsentOnFetchSchema>;

// ============================================================================
// 5. Consent On-Init — POST /api/v3/hiu/consent/request/on-init
// ============================================================================

export const ConsentOnInitSchema = z.object({
  error: z.any().optional(),
  consentRequest: z.object({
    id: z.string().optional(),
  }).optional(),
  response: ResponseRefSchema,
}).passthrough();

export type ConsentOnInitPayload = z.infer<typeof ConsentOnInitSchema>;

// ============================================================================
// Allowed event types that produce artefact storage
// ============================================================================

export const ARTEFACT_PRODUCING_EVENTS = ["CONSENT_GRANTED", "DATA_TRANSFER"] as const;
export type ArtefactProducingEvent = typeof ARTEFACT_PRODUCING_EVENTS[number];
