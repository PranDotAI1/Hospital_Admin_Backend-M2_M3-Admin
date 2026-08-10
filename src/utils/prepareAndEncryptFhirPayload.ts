import * as crypto from "crypto";
import {
  encrypt,
  decrypt,
  generateKeyMaterial as generateFideliusKeys,
} from "./fidelius-crypto";

// export const ABMD_PUBLIC_KEY =
//   "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAstWB95C5pHLXiYW59qyO4Xb+59KYVm9Hywbo77qETZVAyc6VIsxU+UWhd/k/YtjZibCznB+HaXWX9TVTFs9Nwgv7LRGq5uLczpZQDrU7dnGkl/urRA8p0Jv/f8T0MZdFWQgks91uFffeBmJOb58u68ZRxSYGMPe4hb9XXKDVsgoSJaRNYviH7RgAI2QhTCwLEiMqIaUX3p1SAc178ZlN8qHXSSGXvhDR1GKM+y2DIyJqlzfik7lD14mDY/I4lcbftib8cv7llkybtjX1AayfZp4XpmIXKWv8nRM488/jOAF81Bi13paKgpjQUUuwq9tb5Qd/DChytYgBTBTJFe7irDFCmTIcqPr8+IMB7tXA3YXPp3z605Z6cGoYxezUm2Nz2o6oUmarDUntDhq/PnkNergmSeSvS8gD9DHBuJkJWZweG3xOPXiKQAUBr92mdFhJGm6fitO5jsBxgpmulxpG0oKDy9lAOLWSqK92JMcbMNHn4wRikdI9HSiXrrI7fLhJYTbyU3I4v5ESdEsayHXuiwO/1C8y56egzKSw44GAtEpbAkTNEEfK5H5R0QnVBIXOvfeF4tzGvmkfOO6nNXU3o/WAdOyV3xSQ9dqLY5MEL4sJCGY1iJBIAQ452s8v0ynJG5Yq+8hNhsCVnklCzAlsIzQpnSVDUVEzv17grVAw078CAwEAAQ==";

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
  // console.log(
  //   `[ENCRYPTION] Starting encryption for ABDM data push (Node.js)...`,
  // );
  // console.log(`[ENCRYPTION] Data size: ${plainHealthData.length} chars`);

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
    let decryptedString = decrypt(
      encryptedData,
      requesterPrivateKey,
      requesterNonce,
      senderPublicKey, // Could be raw or X509
      senderNonce,
    );

    // Sanitize: Remove trailing null bytes and escape raw control characters
    // that might cause "InvalidBSON" or "Not null terminated string" in MongoDB.
    decryptedString = decryptedString.replace(/\0+$/, "");
    decryptedString = decryptedString.replace(/[\u0000-\u001F]/g, (match) => {
      if (match === '\n') return '\\n';
      if (match === '\r') return '\\r';
      if (match === '\t') return '\\t';
      return ''; // Strip other control chars like \0
    });

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
