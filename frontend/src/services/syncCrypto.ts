/**
 * Client-side end-to-end encryption for cloud sync.
 *
 * The sync password never leaves this device.  We derive an AES-GCM key from
 * the password + a random salt, encrypt the snapshot JSON, and upload only the
 * ciphertext, salt and IV to the server.
 */

const ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getKeyMaterial(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return window.crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
}

async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const material = await getKeyMaterial(password);
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: KEY_LEN_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedSnapshot {
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

export async function encryptSnapshot(
  payload: unknown,
  password: string
): Promise<EncryptedSnapshot> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt.buffer);
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(payload));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  return {
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(encrypted),
  };
}

export async function decryptSnapshot<T = unknown>(
  snapshot: EncryptedSnapshot,
  password: string
): Promise<T> {
  const salt = base64ToArrayBuffer(snapshot.salt);
  const iv = base64ToArrayBuffer(snapshot.iv);
  const ciphertext = base64ToArrayBuffer(snapshot.ciphertext);
  const key = await deriveKey(password, salt);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted)) as T;
}
