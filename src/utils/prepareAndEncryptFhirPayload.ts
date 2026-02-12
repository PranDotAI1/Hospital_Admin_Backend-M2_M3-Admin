import * as crypto from "crypto";
import {
  encrypt,
  decrypt,
  generateKeyMaterial as generateFideliusKeys,
} from "./fidelius-crypto";

/**
 * ABDM Health Data Encryption Utility
 *
 * Replaced python subprocess with Native Node.js BouncyCastle Curve25519 Implementation.
 */

// ============================================================================
// Types
// ============================================================================

export interface ABDMKeyMaterial {
  cryptoAlg: string;
  curve: string;
  dhPublicKey: {
    expiry: string;
    parameters: string;
    keyValue: string; // Base64-encoded public key (88 chars = 65 bytes)
  };
  nonce: string; // Base64-encoded 32-byte nonce
}

export interface EncryptedPayload {
  encryptedData: string;
  keyMaterial: {
    cryptoAlg: string;
    curve: string;
    dhPublicKey: {
      expiry: string;
      parameters: string;
      keyValue: string;
    };
    nonce: string;
  };
}

// Python logic removed

// ============================================================================
// Main Encryption Function
// ============================================================================

/**
 * Encrypt FHIR health data for ABDM data push
 */
export const encryptHealthData = (
  plainHealthData: string,
  hiuKeyMaterial: ABDMKeyMaterial,
): EncryptedPayload => {
  console.log(
    `[ENCRYPTION] Starting encryption for ABDM data push (Node.js)...`,
  );
  console.log(`[ENCRYPTION] Data size: ${plainHealthData.length} chars`);

  // Use Native Node.js Implementation
  const result = encrypt(
    plainHealthData,
    hiuKeyMaterial.dhPublicKey.keyValue,
    hiuKeyMaterial.nonce,
  );

  // Set expiry timestamp
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  return {
    encryptedData: result.encryptedData,
    keyMaterial: {
      cryptoAlg: "ECDH",
      curve: "Curve25519",
      dhPublicKey: {
        expiry,
        parameters: "Curve25519",
        keyValue: result.keyMaterial.x509PublicKey,
      },
      nonce: result.keyMaterial.nonce,
    },
  };
};

/**
 * Generate key material for HIU flow (receiving data).
 * returns private key (to store), public key (to send), and nonce.
 */
export const generateKeyMaterial = (): {
  privateKey: string;
  publicKey: string;
  nonce: string;
  x509PublicKey: string;
} => {
  const keys = generateFideliusKeys();
  return {
    privateKey: keys.privateKey,
    publicKey: keys.publicKey, // Raw 88 chars
    nonce: keys.nonce,
    x509PublicKey: keys.x509PublicKey,
  };
};

/**
 * Decrypt health data received from ABDM (HIU flow).
 */
export const decryptHealthData = (
  encryptedData: string,
  requesterPrivateKey: string,
  requesterNonce: string,
  senderPublicKey: string,
  senderNonce: string,
): { decryptedData: any } => {
  console.log(`[DECRYPTION] Decrypting with Node.js implementation...`);

  try {
    const decryptedString = decrypt(
      encryptedData,
      requesterPrivateKey,
      requesterNonce,
      senderPublicKey, // Could be raw or X509
      senderNonce,
    );

    // Parse the inner JSON (FHIR Bundle)
    const fhirBundle = JSON.parse(decryptedString);
    return { decryptedData: fhirBundle };
  } catch (error) {
    console.error(`[DECRYPTION] Error:`, error);
    throw new Error(
      `Failed to decrypt with Node.js: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

// ============================================================================
// Build Data Push Payload
// ============================================================================

/**
 * Build the complete data push payload for ABDM
 */
export const buildDataPushPayload = (
  fhirBundleJson: string,
  transactionId: string,
  careContextReference: string,
  hiuKeyMaterial: ABDMKeyMaterial,
): any => {
  const encrypted = encryptHealthData(fhirBundleJson, hiuKeyMaterial);

  const checksum = crypto
    .createHash("sha256")
    .update(fhirBundleJson)
    .digest("hex");

  return {
    pageNumber: 0,
    pageCount: 1,
    transactionId,
    entries: [
      {
        content: encrypted.encryptedData,
        media: "application/fhir+json",
        checksum,
        careContextReference,
      },
    ],
    keyMaterial: encrypted.keyMaterial,
  };
};

// ============================================================================
// Legacy Exports (for backward compatibility)
// ============================================================================

export const generateX25519KeyPair = () => {
  console.warn(
    "WARNING: generateX25519KeyPair() is deprecated for ABDM. Use pyfidelius.",
  );
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }),
  };
};

export const deriveSharedSecret = () => {
  throw new Error(
    "deriveSharedSecret() is deprecated. Use encryptHealthData() with pyfidelius.",
  );
};

export const deriveAESKey = () => {
  throw new Error(
    "deriveAESKey() is deprecated. Use encryptHealthData() with pyfidelius.",
  );
};

export const encryptWithAESGCM = () => {
  throw new Error(
    "encryptWithAESGCM() is deprecated. Use encryptHealthData() with pyfidelius.",
  );
};

export const getFinalData = (transactionId: any) => {
  console.warn(
    "WARNING: getFinalData() is deprecated. Use buildDataPushPayload().",
  );
  return {
    pageNumber: 0,
    pageCount: 1,
    transactionId,
    entries: [],
    keyMaterial: {},
  };
};

export const createFhirBundle = () => {
  console.warn(
    "WARNING: createFhirBundle() is deprecated. Use FhirBundleService.",
  );
  return { resourceType: "Bundle", type: "document", entry: [] };
};
