/// src/lib/cryptoVault.ts ///
import { db, type VaultItem, type FileRecord } from './db';

/**
 * Native Web Crypto API Client-Side Privacy Vault
 * - Key derivation: PBKDF2 with SHA-256 and 600,000 iterations
 * - Encryption: AES-GCM (256-bit) with random 96-bit (12 bytes) IV
 * - Zero external WASM dependencies (CSP compliant)
 * - Session state: Stored strictly in memory / sessionStorage (never localStorage)
 */

export const PBKDF2_ITERATIONS = 600000;
export const HASH_ALGO = 'SHA-256';
export const KEY_LENGTH = 256;
export const AES_ALGO = 'AES-GCM';
export const IV_LENGTH = 12; // 96 bits for AES-GCM
export const SALT_LENGTH = 16; // 128 bits

export const SENTINEL_RECORD_ID = '__vault_auth_sentinel__';
export const SENTINEL_PLAINTEXT = 'VAULT_AUTHENTICATION_VERIFIED_V1';
const SESSION_STORAGE_KEY = 'vault_session_unlocked_flag';

// In-memory active session state (wiped on reload/lock/tab close)
let activeSessionKey: CryptoKey | null = null;
let activeSessionSalt: Uint8Array | null = null;
let activeMasterPassphrase: string | null = null;

// Subscribers for reactive UI updates
type VaultStateListener = (unlocked: boolean) => void;
const listeners = new Set<VaultStateListener>();

function notifyListeners(unlocked: boolean) {
  listeners.forEach((listener) => {
    try {
      listener(unlocked);
    } catch (e) {
      console.error('Vault state listener error:', e);
    }
  });
}

/**
 * Subscribe to vault unlock/lock state changes
 */
export function subscribeVaultState(listener: VaultStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Helper: ArrayBuffer/Uint8Array to Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Helper: Base64 to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives a 256-bit AES-GCM key from master passphrase using PBKDF2-SHA256 (600,000 iterations).
 * Native Web Crypto API - window.crypto.subtle
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGO,
    },
    keyMaterial,
    { name: AES_ALGO, length: KEY_LENGTH },
    false, // non-extractable key for defense in depth
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts arbitrary plaintext string using AES-GCM with a random IV.
 * Returns Base64-encoded ciphertext, IV, and salt.
 */
export async function encryptData(
  plaintext: string,
  key?: CryptoKey,
  customSalt?: Uint8Array
): Promise<{ ciphertext: string; iv: string; salt: string }> {
  const encKey = key || activeSessionKey;
  if (!encKey) {
    throw new Error('Vault is locked. Please unlock with master passphrase to encrypt.');
  }

  // Generate 12-byte random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  // Use provided salt or active salt or generate new
  const salt = customSalt || activeSessionSalt || window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const encodedData = new TextEncoder().encode(plaintext);
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: AES_ALGO,
      iv,
    },
    encKey,
    encodedData
  );

  return {
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
  };
}

/**
 * Decrypts AES-GCM ciphertext using the derived key and provided IV.
 */
export async function decryptData(
  encrypted: { ciphertext: string; iv: string; salt: string },
  key?: CryptoKey
): Promise<string> {
  let decKey = key || activeSessionKey;

  // If specific salt differs from active session or no key passed, derive on demand if passphrase in memory
  if (!decKey && activeMasterPassphrase) {
    decKey = await deriveKeyFromPassphrase(
      activeMasterPassphrase,
      base64ToUint8Array(encrypted.salt)
    );
  }

  if (!decKey) {
    throw new Error('Vault is locked. Please unlock with master passphrase to decrypt.');
  }

  const ivBytes = base64ToUint8Array(encrypted.iv);
  const cipherBytes = base64ToUint8Array(encrypted.ciphertext);

  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: AES_ALGO,
        iv: ivBytes,
      },
      decKey,
      cipherBytes
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    console.error('Decryption failed:', err);
    throw new Error('Authentication tag verification failed: incorrect key or tampered ciphertext.');
  }
}

/**
 * Check if the vault has been set up with a master passphrase sentinel
 */
export async function isVaultConfigured(): Promise<boolean> {
  try {
    const sentinel = await db.vault.get(SENTINEL_RECORD_ID);
    return !!sentinel;
  } catch (e) {
    console.warn('Could not check vault configuration:', e);
    return false;
  }
}

/**
 * Check if the vault is currently unlocked in memory
 */
export function isVaultUnlocked(): boolean {
  return activeSessionKey !== null;
}

/**
 * Initialize vault for the first time with a new Master Passphrase
 */
export async function setupMasterPassphrase(passphrase: string): Promise<void> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Master Passphrase must be at least 8 characters long for adequate entropy.');
  }

  // Generate 16-byte cryptographically secure salt
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  // Encrypt sentinel validation canary
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encryptedSentinel = await window.crypto.subtle.encrypt(
    { name: AES_ALGO, iv },
    key,
    new TextEncoder().encode(SENTINEL_PLAINTEXT)
  );

  const sentinelItem: VaultItem = {
    id: SENTINEL_RECORD_ID,
    title: 'Vault Sentinel Canary',
    category: 'credential',
    ciphertext: arrayBufferToBase64(encryptedSentinel),
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.vault.put(sentinelItem);

  // Store in memory & sessionStorage
  activeSessionKey = key;
  activeSessionSalt = salt;
  activeMasterPassphrase = passphrase;
  sessionStorage.setItem(SESSION_STORAGE_KEY, 'unlocked');

  await db.logAction(
    'VAULT_INITIALIZED',
    'VAULT',
    'Privacy Vault',
    'Master passphrase initialized with PBKDF2 (600,000 iterations, AES-GCM 256).'
  );

  notifyListeners(true);
}

/**
 * Unlock existing vault with Master Passphrase
 */
export async function unlockVault(passphrase: string): Promise<boolean> {
  const sentinel = await db.vault.get(SENTINEL_RECORD_ID);
  if (!sentinel) {
    throw new Error('Vault is not yet initialized. Please set a Master Passphrase first.');
  }

  const saltBytes = base64ToUint8Array(sentinel.salt);
  const ivBytes = base64ToUint8Array(sentinel.iv);
  const cipherBytes = base64ToUint8Array(sentinel.ciphertext);

  // Derive candidate key
  const candidateKey = await deriveKeyFromPassphrase(passphrase, saltBytes);

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: AES_ALGO, iv: ivBytes },
      candidateKey,
      cipherBytes
    );

    const decryptedText = new TextDecoder().decode(decrypted);
    if (decryptedText !== SENTINEL_PLAINTEXT) {
      throw new Error('Decrypted canary validation string mismatch.');
    }

    // Passphrase confirmed valid!
    activeSessionKey = candidateKey;
    activeSessionSalt = saltBytes;
    activeMasterPassphrase = passphrase;
    sessionStorage.setItem(SESSION_STORAGE_KEY, 'unlocked');

    await db.logAction(
      'VAULT_UNLOCKED',
      'VAULT',
      'Privacy Vault',
      'Vault successfully unlocked via Master Passphrase verification.'
    );

    notifyListeners(true);
    return true;
  } catch (err) {
    console.warn('Vault unlock verification failed:', err);
    throw new Error('Incorrect Master Passphrase. Decryption authentication failed.');
  }
}

/**
 * Lock vault and securely purge in-memory keys
 */
export async function lockVault(): Promise<void> {
  activeSessionKey = null;
  activeSessionSalt = null;
  activeMasterPassphrase = null;
  sessionStorage.removeItem(SESSION_STORAGE_KEY);

  await db.logAction(
    'VAULT_LOCKED',
    'VAULT',
    'Privacy Vault',
    'Vault locked. Cryptographic keys purged from volatile memory.'
  );

  notifyListeners(false);
}

/**
 * High-level: Store an encrypted note, metadata, or credential in Dexie
 */
export async function addVaultItem(params: {
  title: string;
  content: string;
  category: 'note' | 'metadata' | 'tag' | 'credential';
  associatedFileId?: string;
}): Promise<VaultItem> {
  if (!isVaultUnlocked()) {
    throw new Error('Vault must be unlocked to add encrypted records.');
  }

  const { ciphertext, iv, salt } = await encryptData(params.content);
  const itemId = `vault_item_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const item: VaultItem = {
    id: itemId,
    title: params.title.trim(),
    category: params.category,
    ciphertext,
    iv,
    salt,
    associatedFileId: params.associatedFileId || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.vault.add(item);

  // If associated with a Drive file, mark file as vault-locked
  if (params.associatedFileId) {
    const file = await db.files.get(params.associatedFileId);
    if (file) {
      await db.files.update(params.associatedFileId, { isVaultLocked: true });
    }
  }

  await db.logAction(
    'VAULT_ITEM_ADDED',
    itemId,
    item.title,
    `Added encrypted ${item.category} (AES-GCM 256-bit).`
  );

  return item;
}

/**
 * High-level: Decrypt a specific VaultItem record
 */
export async function decryptVaultItem(item: VaultItem): Promise<string> {
  return await decryptData({
    ciphertext: item.ciphertext,
    iv: item.iv,
    salt: item.salt,
  });
}

/**
 * High-level: Delete a VaultItem from Dexie
 */
export async function deleteVaultItem(itemId: string): Promise<void> {
  const item = await db.vault.get(itemId);
  if (!item) return;

  await db.vault.delete(itemId);

  // If linked to a file, check if any other vault items still reference it
  if (item.associatedFileId) {
    const remainingForFile = await db.vault
      .where('associatedFileId')
      .equals(item.associatedFileId)
      .count();
    if (remainingForFile === 0) {
      await db.files.update(item.associatedFileId, { isVaultLocked: false });
    }
  }

  await db.logAction(
    'VAULT_ITEM_DELETED',
    itemId,
    item.title,
    `Removed encrypted vault item.`
  );
}

/**
 * Reset vault (clears all encrypted data and allows new passphrase configuration)
 */
export async function resetVault(): Promise<void> {
  await lockVault();
  await db.vault.clear();
  // Clear any vault locked flags on files
  const lockedFiles = await db.files.where('isVaultLocked').equals(1 as any).toArray();
  for (const f of lockedFiles) {
    await db.files.update(f.id, { isVaultLocked: false });
  }

  await db.logAction(
    'VAULT_RESET',
    'VAULT',
    'Privacy Vault',
    'All vault records purged and master passphrase reset.'
  );

  notifyListeners(false);
}
