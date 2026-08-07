/**
 * ABDM-Compliant Clinical Terminology Service
 *
 * Provides standardized search for medicines, lab tests, procedures, and conditions
 * using FHIR R4 ValueSet/$expand operations against a terminology server.
 *
 * Code Systems used (per ABDM FHIR IG v6.5.0):
 *  - Medicines:   SNOMED CT  (ECL: <<763158003 | Medicinal product)
 *  - Lab Tests:   LOINC      (http://loinc.org/vs)
 *  - Procedures:  SNOMED CT  (ECL: <<71388002 | Procedure)
 *  - Conditions:  SNOMED CT  (ECL: <<404684003 | Clinical finding)
 *
 * Server: CSIRO Ontoserver (configurable via TERMINOLOGY_SERVER_URL env var)
 */

import axios, { AxiosError } from "axios";

// ─── Configuration ─────────────────────────────────────────────────────────────

const TERMINOLOGY_SERVER_URL =
  process.env.TERMINOLOGY_SERVER_URL ||
  "https://tx.ontoserver.csiro.au/fhir";

const USER_AGENT = "Hospital-Admin-Backend/1.0";
const DEFAULT_COUNT = 10;
const MAX_COUNT = 50;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;

// Cache configuration
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 500;

// ─── ABDM ValueSet URIs ────────────────────────────────────────────────────────

/**
 * SNOMED CT ECL for Medicinal Products.
 * Per ABDM ndhm-medicine-codes ValueSet: Clinical Drugs from SNOMED CT International
 * Edition + Common Drug Codes for India (National Extension).
 * <<763158003 covers all descendants of "Medicinal product (product)".
 */
const MEDICINE_VALUESET_URL =
  "http://snomed.info/sct?fhir_vs=ecl/<<763158003";

/**
 * LOINC ValueSet for laboratory observations.
 * This is the implicit LOINC ValueSet covering all LOINC concepts.
 */
const LAB_TEST_VALUESET_URL = "http://loinc.org/vs";

/**
 * SNOMED CT ECL for Procedures.
 * <<71388002 covers all descendants of "Procedure (procedure)".
 */
const PROCEDURE_VALUESET_URL =
  "http://snomed.info/sct?fhir_vs=ecl/<<71388002";

/**
 * SNOMED CT ECL for Clinical Findings (conditions/diagnoses).
 * <<404684003 covers all descendants of "Clinical finding (finding)".
 */
const CONDITION_VALUESET_URL =
  "http://snomed.info/sct?fhir_vs=ecl/<<404684003";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TerminologyResult {
  code: string;
  display: string;
  system: string;
}

interface CacheEntry {
  results: TerminologyResult[];
  timestamp: number;
}

// ─── In-Memory LRU Cache ──────────────────────────────────────────────────────

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): TerminologyResult[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.results;
  }

  set(key: string, results: TerminologyResult[]): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { results, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const terminologyCache = new LRUCache(CACHE_MAX_ENTRIES, CACHE_TTL_MS);

// ─── Core FHIR ValueSet/$expand ────────────────────────────────────────────────

/**
 * Performs a FHIR ValueSet/$expand operation against the terminology server
 * with retry logic and caching.
 */
async function expandValueSet(
  valueSetUrl: string,
  filter: string,
  count: number,
): Promise<TerminologyResult[]> {
  const cacheKey = `${valueSetUrl}|${filter}|${count}`;

  // Check cache first
  const cached = terminologyCache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const expandUrl = `${TERMINOLOGY_SERVER_URL}/ValueSet/$expand`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get(expandUrl, {
        params: {
          url: valueSetUrl,
          filter: filter,
          count: Math.min(count, MAX_COUNT),
        },
        headers: {
          Accept: "application/fhir+json",
          "User-Agent": USER_AGENT,
        },
        timeout: 15000, // 15s timeout
      });

      const results: TerminologyResult[] = [];

      if (response.data?.expansion?.contains) {
        for (const item of response.data.expansion.contains) {
          if (item.code && item.display) {
            results.push({
              code: item.code,
              display: item.display,
              system: item.system || valueSetUrl.split("?")[0],
            });
          }
        }
      }

      // Cache successful results
      terminologyCache.set(cacheKey, results);
      return results;
    } catch (error) {
      lastError = error as Error;

      const axiosErr = error as AxiosError;
      const status = axiosErr.response?.status;

      // Don't retry on 4xx client errors (except 429 Rate Limit)
      if (status && status >= 400 && status < 500 && status !== 429) {
        console.error(
          `[Terminology] Client error ${status} for ${valueSetUrl} filter="${filter}"`,
          axiosErr.response?.data || axiosErr.message,
        );
        break;
      }

      // Exponential backoff for retryable errors
      if (attempt < MAX_RETRIES - 1) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[Terminology] Attempt ${attempt + 1}/${MAX_RETRIES} failed for "${filter}". Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted — graceful degradation
  console.error(
    `[Terminology] All ${MAX_RETRIES} attempts failed for ${valueSetUrl} filter="${filter}":`,
    lastError?.message,
  );
  return [];
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Search for medicines using SNOMED CT Clinical Drug hierarchy.
 * Per ABDM: MedicationRequest.medicationCodeableConcept must use codes
 * from the ndhm-medicine-codes ValueSet (SNOMED CT <<763158003).
 *
 * @param term - Search term (e.g., "paracetamol", "amoxicillin")
 * @param count - Max results (default 10, max 50)
 */
export async function searchMedicines(
  term: string,
  count: number = DEFAULT_COUNT,
): Promise<TerminologyResult[]> {
  if (!term || term.trim().length < 2) return [];
  return expandValueSet(MEDICINE_VALUESET_URL, term.trim(), count);
}

/**
 * Search for laboratory tests using LOINC codes.
 * Per ABDM: Observation.code in DiagnosticReport must use LOINC codes.
 *
 * @param term - Search term (e.g., "glucose", "hemoglobin", "CBC")
 * @param count - Max results (default 10, max 50)
 */
export async function searchLabTests(
  term: string,
  count: number = DEFAULT_COUNT,
): Promise<TerminologyResult[]> {
  if (!term || term.trim().length < 2) return [];
  return expandValueSet(LAB_TEST_VALUESET_URL, term.trim(), count);
}

/**
 * Search for procedures using SNOMED CT Procedure hierarchy.
 * Per ABDM: Procedure.code should use SNOMED CT codes from <<71388002.
 *
 * @param term - Search term (e.g., "appendectomy", "biopsy")
 * @param count - Max results (default 10, max 50)
 */
export async function searchProcedures(
  term: string,
  count: number = DEFAULT_COUNT,
): Promise<TerminologyResult[]> {
  if (!term || term.trim().length < 2) return [];
  return expandValueSet(PROCEDURE_VALUESET_URL, term.trim(), count);
}

/**
 * Search for clinical findings/conditions using SNOMED CT hierarchy.
 * Per ABDM: Condition.code should use SNOMED CT codes from <<404684003.
 *
 * @param term - Search term (e.g., "diabetes", "hypertension")
 * @param count - Max results (default 10, max 50)
 */
export async function searchConditions(
  term: string,
  count: number = DEFAULT_COUNT,
): Promise<TerminologyResult[]> {
  if (!term || term.trim().length < 2) return [];
  return expandValueSet(CONDITION_VALUESET_URL, term.trim(), count);
}

/**
 * Clear the terminology cache. Useful for admin/maintenance operations.
 */
export function clearTerminologyCache(): void { 
  terminologyCache.clear();
}

export const TerminologyService = {
  searchMedicines,
  searchLabTests,
  searchProcedures,
  searchConditions,
  clearTerminologyCache,
};
