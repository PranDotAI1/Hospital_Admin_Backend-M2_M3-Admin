import express, { Request, Response } from "express";
import forge from "node-forge";
import crypto from "crypto";

// =========================
// Utility: Generate FHIR Bundle
// =========================
export const createFhirBundle = () => {
    return {
        resourceType: "Bundle",
        type: "document",
        id: "opconsult-001",
        timestamp: new Date().toISOString(),
        entry: [
            {
                fullUrl: "urn:uuid:patient-op-1",
                resource: {
                    resourceType: "Patient",
                    id: "patient-op-1",
                    identifier: [
                        { system: "http://abdm.gov.in/identifiers/abha", value: "91486188260104@sbx" }
                    ],
                    name: [{ text: "Ankit Kumar" }],
                    gender: "male",
                    birthDate: "1995-04-15"
                }
            },
            {
                fullUrl: "urn:uuid:composition-op-1",
                resource: {
                    resourceType: "Composition",
                    id: "composition-op-1",
                    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord"] },
                    status: "final",
                    type: { text: "OP Consultation Note" },
                    subject: { reference: "urn:uuid:patient-op-1" },
                    date: new Date().toISOString(),
                    title: "OP Consultation",
                    section: [
                        { title: "History", text: { status: "generated", div: "<div>Fever, cough</div>" } },
                        { title: "Plan", text: { status: "generated", div: "<div>Rest and Paracetamol</div>" } }
                    ]
                }
            }
        ]
    };
}

// =========================
// AES Encryption
// =========================
export const encryptWithAES = (
    plainText: string,
    key: Buffer
): { encryptedData: string; iv: string; authTag: string } => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        encryptedData: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
    };
};



// =========================
// RSA Encryption of AES Key
// =========================
export const encryptAESKeyWithHIUPublicKey = (aesKey: Buffer, hiuPublicKeyPem: string) => {
    const encryptedKey = crypto.publicEncrypt(
        { key: hiuPublicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
        aesKey
    );
    return encryptedKey.toString("base64");
}

// =========================
// Key Material Generation
// =========================
export function generateKeyMaterial() {
    const ecdh = crypto.createECDH("x25519");
    const publicKey = ecdh.generateKeys(); // Generates a random private key internally

    return {
        cryptoAlg: "ECDH",
        curve: "Curve25519",
        dhPublicKey: {
            expiry: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour expiry
            parameters: "Curve25519", // Standard curve name
            keyValue: publicKey.toString("base64") // Public key in base64
        },
        nonce: crypto.randomBytes(12).toString("base64"), // 96-bit nonce
        // Keep the private key if you'll need to derive shared secrets later
        privateKey: ecdh.getPrivateKey().toString("base64")
    };
}

// =========================
// Final Payload Builder
// =========================
export const buildFinalPayload = (encryptedData: any, keyMaterial: any, transactionId: string) => {
    return {
        pageNumber: 0,
        pageCount: 1,
        transactionId: transactionId,
        entries: [
            {
                content: encryptedData,
                media: "application/fhir+json",
                checksum: "checksum-here", // generate SHA256 if needed
                careContextReference: "care-context-1"
            }
        ],
        keyMaterial
    };
}

export const getFinalData = (transactionId: any) => {
    const fhirBundle = createFhirBundle();
    const plainHealthData = JSON.stringify(fhirBundle);

    // 2. Generate AES key
    const aesKey = crypto.randomBytes(32);

    // 3. Encrypt FHIR data
    const { encryptedData } = encryptWithAES(plainHealthData, aesKey);

    // 4. HIU Public Key (PEM from ABDM registry)
    const hiuPublicKeyPem = `-----BEGIN PUBLIC KEY----- MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAstWB95C5pHLXiYW59qyO 4Xb+59KYVm9Hywbo77qETZVAyc6VIsxU+UWhd/k/YtjZibCznB+HaXWX9TVTFs9N wgv7LRGq5uLczpZQDrU7dnGkl/urRA8p0Jv/f8T0MZdFWQgks91uFffeBmJOb58u 68ZRxSYGMPe4hb9XXKDVsgoSJaRNYviH7RgAI2QhTCwLEiMqIaUX3p1SAc178ZlN 8qHXSSGXvhDR1GKM+y2DIyJqlzfik7lD14mDY/I4lcbftib8cv7llkybtjX1Aayf Zp4XpmIXKWv8nRM488/jOAF81Bi13paKgpjQUUuwq9tb5Qd/DChytYgBTBTJFe7i rDFCmTIcqPr8+IMB7tXA3YXPp3z605Z6cGoYxezUm2Nz2o6oUmarDUntDhq/PnkN ergmSeSvS8gD9DHBuJkJWZweG3xOPXiKQAUBr92mdFhJGm6fitO5jsBxgpmulxpG 0oKDy9lAOLWSqK92JMcbMNHn4wRikdI9HSiXrrI7fLhJYTbyU3I4v5ESdEsayHXu iwO/1C8y56egzKSw44GAtEpbAkTNEEfK5H5R0QnVBIXOvfeF4tzGvmkfOO6nNXU3 o/WAdOyV3xSQ9dqLY5MEL4sJCGY1iJBIAQ452s8v0ynJG5Yq+8hNhsCVnklCzAls IzQpnSVDUVEzv17grVAw078CAwEAAQ== -----END PUBLIC KEY-----`;

    // 5. Encrypt AES key
    const hiuEncryptedKey = encryptAESKeyWithHIUPublicKey(aesKey, hiuPublicKeyPem);

    // 6. Generate key material
    const keyMaterial = generateKeyMaterial();

    // 7. Build final payload
    const finalPayload = buildFinalPayload(encryptedData, keyMaterial, transactionId);
    return finalPayload;

}