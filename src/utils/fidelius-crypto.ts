import crypto from "crypto";
import { Buffer } from "buffer";
import elliptic from "elliptic";
import hash from "hash.js";
import BN from "bn.js";

const ShortCurve = elliptic.curve.short;

// ============================================================================
// 1. Custom Curve Definition (BouncyCastle Curve25519 Weierstrass)
// ============================================================================

const CURVE_PARAMS = {
  p: "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed",
  a: "2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa984914a144",
  b: "7b425ed097b425ed097b425ed097b425ed097b425ed097b4260b5e9c7710c864",
  n: "1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3",
  h: "08",
  g: [
    "2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad245a",
    "20ae19a1b8a086b4e01edd2c7748d14c923d4d7e6d7c61b229e9c5a27eced3d9",
  ],
};

// Instantiate the curve
const curve = new ShortCurve({
  p: new BN(CURVE_PARAMS.p, 16),
  a: new BN(CURVE_PARAMS.a, 16),
  b: new BN(CURVE_PARAMS.b, 16),
});

// Attach parameters EC expects to simulate a preset
const gPoint = curve.point(
  new BN(CURVE_PARAMS.g[0], 16),
  new BN(CURVE_PARAMS.g[1], 16),
);
const nBN = new BN(CURVE_PARAMS.n, 16);
const hBN = new BN(CURVE_PARAMS.h, 16);

// Attach n to the curve instance so EC constructor can find it
(curve as any).n = nBN;

// Because ShortCurve instances don't natively hold n/g/h in a way EC constructor
// expects directly (if not a preset), we wrap it.
// This matches internal elliptic behavior for preset curves.
const presetCurve = {
  curve: curve,
  g: gPoint,
  n: nBN,
  h: hBN,
  hash: hash.sha256,
};

const ec = new elliptic.ec({
  curve: presetCurve,
  hash: hash.sha256,
} as any);

// ============================================================================
// 2. Constants & Helpers
// ============================================================================

// X.509 SPKI Prefix for BouncyCastle Curve25519 (extracted from pyfidelius)
// Ends with 04 (octet string tag for key) - NO, wait.
// The dump ended with 04.
// If python code appends b'\x04' + x + y
// And prefix dump ended with 04.
// Then prefix ALREADY has 04?
// Let's re-read python code:
// b64encode( b64decode(fixed_prefix) + x + y )
// If fixed_prefix has 04 at end?
// My dump output: ...03420004
// Python code: b'\x04' + x + y.
// So python ADDS 04.
// If prefix ALREADY has 04, then we have TWO 04s?
// Let's check dump again.
// verify_crypto_logic.ts output of pyHeader: ...03420004.
// Wait, verify script printed `pyHeader`.
// `pyHeader` was derived from: `pyBuf.subarray(0, length - 65)`.
// Key (X+Y) is 64 bytes.
// Python adds 04 + X + Y (65 bytes).
// So `pyBuf` length = matches.
// If I strip 65 bytes, I stripped 04 + X + Y.
// So `pyHeader` DOES NOT have the final 04.
// Let's look at `dump_prefix.ts` output again (Step 215).
// `...03420004`.
// Length: 309 hex chars? No, hex string length was printed?
// `dump_prefix` output was the HEX STRING of the decoded buffer.
// The hex string ended with `04`.
// So the Python hardcoded prefix HAS the `04`.
// BUT Python code ADDS `b'\x04'`.
// `b'\x04' + x_bytes + y_bytes`.
// So Python code adds a SECOND `04`?
// Let's check `pyfidelius` (Step 192) line 83:
// `base64.b64decode(fixed_prefix_b64) + x_bytes + y_bytes`
// Line 69-70: `x_bytes` and `y_bytes` are raw integers to bytes.
// **It DOES NOT ADD 04 in `encode_x509` method!**
// See Line 83.
// It DOES add 04 in `encode_public_key_to_base64` (Line 73).
// But `encode_x509` uses `x_bytes` and `y_bytes` directly.
// So the `04` MUST comes from `fixed_prefix_b64`.
// My dump of `fixed_prefix_b64` ended with `04`.
// So yes, extracting/using the prefix hex I dumped is correct, and I should append X+Y (64 bytes).
// Correct.

const X509_HEADER_HEX =
  "308201313081ea06072a8648ce3d02013081de020101302b06072a8648ce3d010102207fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed304404202aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa984914a14404207b425ed097b425ed097b425ed097b425ed097b425ed097b4260b5e9c7710c8640441042aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaad245a20ae19a1b8a086b4e01edd2c7748d14c923d4d7e6d7c61b229e9c5a27eced3d902201000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed02010803420004";

const xorBytes = (a: Buffer, b: Buffer): Buffer => {
  const length = Math.min(a.length, b.length);
  const result = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
};

// Helper: Decode public key from X509 or Raw. Elliptic expects uncompressed hex: 04 + X + Y (65 bytes = 130 hex chars).
const decodePeerKey = (b64: string): string => {
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 100) {
    // X.509/SPKI: BIT STRING often has unused-bits byte then key. Common layouts:
    // - Last 66 bytes: 00 04 X Y (unused 0, then uncompressed 04 X Y) — e.g. BouncyCastle/Java
    // - Last 65 bytes: 04 X Y
    // - Last 64 bytes: X Y (prepend 04)
    if (buf.length >= 66) {
      const last66 = buf.subarray(buf.length - 66);
      if (last66[0] === 0x00 && last66[1] === 0x04) {
        return Buffer.concat([Buffer.from([0x04]), last66.subarray(2)]).toString("hex");
      }
    }
    const last65 = buf.subarray(buf.length - 65);
    if (last65[0] === 0x04) {
      return last65.toString("hex");
    }
    return Buffer.concat([Buffer.from([0x04]), buf.subarray(buf.length - 64)]).toString("hex");
  }
  // Raw 88 chars (65 bytes decoded) is already 04+X+Y
  return buf.toString("hex");
};

// ============================================================================
// 3. Exports
// ============================================================================

export interface KeyMaterial {
  privateKey: string;
  publicKey: string;
  nonce: string;
  x509PublicKey: string;
}

export const generateKeyMaterial = (): KeyMaterial => {
  const keyPair = ec.genKeyPair();
  const privateKey = keyPair.getPrivate("hex"); // 32 bytes hex

  // Public Key (Uncompressed 04 + X + Y)
  const publicKeyUncompressed = keyPair.getPublic(false, "hex");

  // X.509 format: Header + (X + Y)
  // Header ends with 04. PublicKeyUncompressed starts with 04.
  // We need to avoid double 04.
  // X509_HEADER_HEX ends with 04.
  // publicKeyUncompressed starts with 04.
  // So we strip 04 from publicKeyUncompressed.
  const pubKeyXY = publicKeyUncompressed.substring(2);
  const x509B64 = Buffer.from(X509_HEADER_HEX + pubKeyXY, "hex").toString(
    "base64",
  );

  const nonce = crypto.randomBytes(32).toString("base64");

  return {
    privateKey: Buffer.from(privateKey, "hex").toString("base64"),
    publicKey: Buffer.from(publicKeyUncompressed, "hex").toString("base64"),
    nonce,
    x509PublicKey: x509B64,
  };
};

export const encrypt = (
  data: string, // string to encrypt
  requesterPublicKey: string, // Base64
  requesterNonce: string, // Base64
): { encryptedData: string; keyMaterial: KeyMaterial } => {
  // 1. Generate Ephemeral Keys (Sender)
  const senderKeys = generateKeyMaterial();

  // 2. Shared Secret
  // Decode requester key
  const peerPubHex = decodePeerKey(requesterPublicKey);
  const peerKey = ec.keyFromPublic(peerPubHex, "hex");
  const senderPriv = ec.keyFromPrivate(
    Buffer.from(senderKeys.privateKey, "base64"),
  );

  const shared = senderPriv.derive(peerKey.getPublic());
  const sharedSecret = shared.toArrayLike(Buffer, "be", 32);

  // 3. Params
  const sNonce = Buffer.from(senderKeys.nonce, "base64");
  const rNonce = Buffer.from(requesterNonce, "base64");
  const xorNonce = xorBytes(sNonce, rNonce);

  const salt = xorNonce.subarray(0, 20);
  const iv = xorNonce.subarray(20, 32); // Last 12 bytes

  // 4. HKDF
  const key = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, salt, Buffer.alloc(0), 32),
  );

  // 5. Encrypt
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return {
    encryptedData: Buffer.from(encrypted + tag, "hex").toString("base64"),
    keyMaterial: senderKeys,
  };
};

export const decrypt = (
  encryptedDataB64: string,
  receiverPrivateKey: string,
  receiverNonce: string,
  senderPublicKey: string,
  senderNonce: string,
): string => {
  // 1. Inputs
  const rPriv = ec.keyFromPrivate(Buffer.from(receiverPrivateKey, "base64"));
  const sPubHex = decodePeerKey(senderPublicKey);
  const sPub = ec.keyFromPublic(sPubHex, "hex");

  const rNonce = Buffer.from(receiverNonce, "base64");
  const sNonce = Buffer.from(senderNonce, "base64");

  // 2. Shared Secret
  const shared = rPriv.derive(sPub.getPublic());
  const sharedSecret = shared.toArrayLike(Buffer, "be", 32);

  // 3. Params
  const xorNonce = xorBytes(sNonce, rNonce);
  const salt = xorNonce.subarray(0, 20);
  const iv = xorNonce.subarray(20, 32);

  // 4. HKDF
  const key = Buffer.from(
    crypto.hkdfSync("sha256", sharedSecret, salt, Buffer.alloc(0), 32),
  );

  // 5. Decrypt
  const encryptedBuf = Buffer.from(encryptedDataB64, "base64");
  const tag = encryptedBuf.subarray(encryptedBuf.length - 16);
  const ciphertext = encryptedBuf.subarray(0, encryptedBuf.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};
