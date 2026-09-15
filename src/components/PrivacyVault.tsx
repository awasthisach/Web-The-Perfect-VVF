/// src/components/PrivacyVault.tsx ///
import React, { useState, useEffect, useId } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type VaultItem, type FileRecord } from '../lib/db';
import {
  isVaultConfigured,
  isVaultUnlocked,
  setupMasterPassphrase,
  unlockVault,
  lockVault,
  addVaultItem,
  decryptVaultItem,
  deleteVaultItem,
  resetVault,
  subscribeVaultState,
  PBKDF2_ITERATIONS,
  SENTINEL_RECORD_ID,
} from '../lib/cryptoVault';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Key,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  FileText,
  Tag,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  Info,
  Layers,
  Search,
  Sparkles,
  Database,
  ExternalLink,
} from 'lucide-react';

export const PrivacyVault: React.FC = () => {
  // Vault state
  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => isVaultUnlocked());
  const [checkingConfig, setCheckingConfig] = useState<boolean>(true);

  // Form inputs
  const [passphrase, setPassphrase] = useState<string>('');
  const [confirmPassphrase, setConfirmPassphrase] = useState<string>('');
  const [showPassphrase, setShowPassphrase] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Add Note / Item Form
  const [activeTab, setActiveTab] = useState<'items' | 'add'>('items');
  const [newTitle, setNewTitle] = useState<string>('');
  const [newContent, setNewContent] = useState<string>('');
  const [newCategory, setNewCategory] = useState<'note' | 'metadata' | 'tag' | 'credential'>('note');
  const [selectedFileId, setSelectedFileId] = useState<string>('');

  // Item inspection & decrypted cache
  const [decryptedCache, setDecryptedCache] = useState<Record<string, string>>({});
  const [decryptingItemId, setDecryptingItemId] = useState<string | null>(null);
  const [viewCiphertextId, setViewCiphertextId] = useState<string | null>(null);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const setupPassphraseId = useId();
  const confirmPassphraseId = useId();
  const unlockPassphraseId = useId();
  const noteTitleId = useId();
  const noteCategoryId = useId();
  const noteFileId = useId();
  const noteContentId = useId();

  // Reactive Dexie query for Vault items (excluding sentinel verification canary)
  const vaultItems = useLiveQuery(async () => {
    try {
      const items = await db.vault.toArray();
      return items.filter((item) => item.id !== SENTINEL_RECORD_ID);
    } catch {
      return [];
    }
  }, []);

  // Reactive Dexie query for cached Drive files for linking
  const cachedFiles = useLiveQuery(async () => {
    try {
      return await db.files.where('trashed').equals(0 as any).toArray();
    } catch {
      return [];
    }
  }, []);

  // Check configuration status on mount
  useEffect(() => {
    async function checkStatus() {
      setCheckingConfig(true);
      try {
        const configured = await isVaultConfigured();
        setIsConfigured(configured);
        setIsUnlocked(isVaultUnlocked());
      } catch (e) {
        console.error('Failed to check vault status:', e);
      } finally {
        setCheckingConfig(false);
      }
    }
    checkStatus();

    // Subscribe to vault state changes
    const unsubscribe = subscribeVaultState((unlocked) => {
      setIsUnlocked(unlocked);
      if (!unlocked) {
        setDecryptedCache({});
      }
    });

    return () => unsubscribe();
  }, []);

  const showToast = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Handler: Setup master passphrase for the first time
  const handleSetupPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (passphrase.length < 8) {
      setAuthError('Passphrase must be at least 8 characters long.');
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setAuthError('Passphrase confirmation does not match.');
      return;
    }

    setIsProcessing(true);
    try {
      await setupMasterPassphrase(passphrase);
      setIsConfigured(true);
      setIsUnlocked(true);
      setPassphrase('');
      setConfirmPassphrase('');
      showToast('Privacy Vault created! AES-GCM 256-bit key initialized with PBKDF2 (600,000 iterations).');
    } catch (err: any) {
      setAuthError(err.message || 'Failed to initialize vault.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handler: Unlock vault
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!passphrase) {
      setAuthError('Please enter your Master Passphrase.');
      return;
    }

    setIsProcessing(true);
    try {
      await unlockVault(passphrase);
      setIsUnlocked(true);
      setPassphrase('');
      showToast('Vault unlocked! Cryptographic keys loaded into volatile memory.');
    } catch (err: any) {
      setAuthError(err.message || 'Incorrect master passphrase.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handler: Lock vault
  const handleLock = async () => {
    await lockVault();
    setIsUnlocked(false);
    setDecryptedCache({});
    setViewCiphertextId(null);
    showToast('Vault locked. Cryptographic keys purged from volatile memory.');
  };

  // Handler: Reset vault
  const handleResetVault = async () => {
    if (
      window.confirm(
        'Are you sure you want to reset the Privacy Vault? This will PERMANENTLY ERASE all encrypted vault notes and your master passphrase.'
      )
    ) {
      setIsProcessing(true);
      try {
        await resetVault();
        setIsConfigured(false);
        setIsUnlocked(false);
        setDecryptedCache({});
        setPassphrase('');
        setConfirmPassphrase('');
        showToast('Privacy Vault reset successfully. You can now configure a new Master Passphrase.');
      } catch (err: any) {
        setAuthError(err.message || 'Failed to reset vault.');
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Handler: Add new secure item
  const handleAddSecureItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) {
      showToast('Please provide both a title and secret content.');
      return;
    }

    setIsProcessing(true);
    try {
      await addVaultItem({
        title: newTitle.trim(),
        content: newContent.trim(),
        category: newCategory,
        associatedFileId: selectedFileId || undefined,
      });

      setNewTitle('');
      setNewContent('');
      setSelectedFileId('');
      setActiveTab('items');
      showToast(`Encrypted and stored "${newTitle}" in Dexie vault table.`);
    } catch (err: any) {
      showToast(`Failed to encrypt: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handler: Reveal / Decrypt an item
  const handleToggleDecrypt = async (item: VaultItem) => {
    if (decryptedCache[item.id]) {
      // Toggle off
      const nextCache = { ...decryptedCache };
      delete nextCache[item.id];
      setDecryptedCache(nextCache);
      return;
    }

    setDecryptingItemId(item.id);
    try {
      const plaintext = await decryptVaultItem(item);
      setDecryptedCache((prev) => ({ ...prev, [item.id]: plaintext }));
    } catch (err: any) {
      showToast(`Decryption error: ${err.message}`);
    } finally {
      setDecryptingItemId(null);
    }
  };

  // Handler: Delete item
  const handleDeleteItem = async (itemId: string, title: string) => {
    if (window.confirm(`Delete encrypted item "${title}" from the local vault?`)) {
      try {
        await deleteVaultItem(itemId);
        const nextCache = { ...decryptedCache };
        delete nextCache[itemId];
        setDecryptedCache(nextCache);
        showToast(`Removed "${title}" from vault.`);
      } catch (err: any) {
        showToast(`Failed to delete: ${err.message}`);
      }
    }
  };

  // Handler: Copy decrypted plaintext
  const handleCopyPlaintext = (itemId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItemId(itemId);
    setTimeout(() => setCopiedItemId(null), 2500);
  };

  // Filtered items
  const filteredItems = (vaultItems || []).filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  if (checkingConfig) {
    return (
      <div className="p-8 bg-neutral-900/60 border border-neutral-800 rounded-2xl flex items-center justify-center gap-3 text-neutral-400 text-sm">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
        <span>Initializing Web Crypto Privacy Vault...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notice */}
      {actionNotice && (
        <div className="p-3 bg-indigo-950/90 border border-indigo-800/80 rounded-xl text-indigo-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-indigo-400 hover:text-white text-xs font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Container Card */}
      <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Vault Header Banner */}
        <div className="p-5 border-b border-neutral-800 bg-neutral-900/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center border shadow-inner ${
                isUnlocked
                  ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400'
              }`}
            >
              {isUnlocked ? <ShieldCheck className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-semibold text-neutral-100">Local Privacy Vault</h2>
                <span
                  className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium border flex items-center gap-1 ${
                    isUnlocked
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}
                >
                  {isUnlocked ? (
                    <>
                      <Unlock className="w-3 h-3 text-emerald-400" /> Unlocked (Volatile Memory)
                    </>
                  ) : (
                    <>
                      <Lock className="w-3 h-3 text-neutral-400" /> Locked (AES-GCM 256)
                    </>
                  )}
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Zero-knowledge client-side encryption via Web Crypto API • PBKDF2 (SHA-256, 600k iterations)
              </p>
            </div>
          </div>

          {/* Action buttons */}
          {isUnlocked && (
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={handleLock}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-medium text-neutral-200 transition"
                title="Purge cryptographic keys from volatile memory"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Lock Vault</span>
              </button>
            </div>
          )}
        </div>

        {/* VIEW 1: Vault Not Configured (First-Time Setup) */}
        {!isConfigured && !isUnlocked && (
          <div className="p-6 sm:p-8 max-w-xl mx-auto space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mx-auto">
                <Key className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-neutral-100">Set Up Your Master Passphrase</h3>
              <p className="text-xs text-neutral-400 leading-relaxed max-w-md mx-auto">
                Your Master Passphrase derives a 256-bit AES-GCM key inside your browser. Your key is stored strictly in memory and is never transmitted over the network or saved to localStorage.
              </p>
            </div>

            {/* Cryptographic Guarantees Box */}
            <div className="p-4 rounded-xl bg-neutral-950/70 border border-neutral-800 text-xs text-neutral-300 space-y-2.5">
              <div className="flex items-center gap-2 text-indigo-400 font-medium">
                <Shield className="w-4 h-4" />
                <span>Client-Side Security Specifications:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-neutral-400 text-[11px]">
                <li>Algorithm: <strong>AES-GCM (256-bit)</strong> with 96-bit unique IV per item</li>
                <li>Key Derivation: <strong>PBKDF2-SHA-256</strong> with <strong>600,000 iterations</strong></li>
                <li>Storage: Ciphertext safely stored in IndexedDB (<code>db.vault</code>)</li>
                <li>Zero-Knowledge: Lost passphrases <em>cannot be reset or recovered</em></li>
              </ul>
            </div>

            {authError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleSetupPassphrase} className="space-y-4">
              <div>
                <label
                  htmlFor={setupPassphraseId}
                  className="block text-xs font-medium text-neutral-300 mb-1.5"
                >
                  Master Passphrase (min. 8 characters)
                </label>
                <div className="relative">
                  <input
                    id={setupPassphraseId}
                    type={showPassphrase ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="Enter a strong, memorable passphrase..."
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className="w-full text-xs bg-neutral-950 border border-neutral-700/90 rounded-xl px-3.5 py-2.5 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200"
                  >
                    {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor={confirmPassphraseId}
                  className="block text-xs font-medium text-neutral-300 mb-1.5"
                >
                  Confirm Master Passphrase
                </label>
                <input
                  id={confirmPassphraseId}
                  type={showPassphrase ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder="Re-type your master passphrase..."
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  className="w-full text-xs bg-neutral-950 border border-neutral-700/90 rounded-xl px-3.5 py-2.5 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                type="submit"
                disabled={isProcessing || passphrase.length < 8}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-md transition"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Deriving Key (600,000 iterations)...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Initialize Privacy Vault</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* VIEW 2: Vault Configured, but Locked */}
        {isConfigured && !isUnlocked && (
          <div className="p-6 sm:p-8 max-w-md mx-auto space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-amber-600/20 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-neutral-100">Unlock Privacy Vault</h3>
              <p className="text-xs text-neutral-400">
                Enter your Master Passphrase to derive your AES-256 decryption key.
              </p>
            </div>

            {authError && (
              <div className="p-3 bg-rose-950/80 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleUnlock} className="space-y-4">
              <div>
                <label
                  htmlFor={unlockPassphraseId}
                  className="block text-xs font-medium text-neutral-300 mb-1.5"
                >
                  Master Passphrase
                </label>
                <div className="relative">
                  <input
                    id={unlockPassphraseId}
                    type={showPassphrase ? 'text' : 'password'}
                    required
                    placeholder="Enter Master Passphrase..."
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className="w-full text-xs bg-neutral-950 border border-neutral-700/90 rounded-xl px-3.5 py-2.5 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200"
                  >
                    {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isProcessing || !passphrase}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-md transition"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Verifying with PBKDF2...</span>
                  </>
                ) : (
                  <>
                    <Unlock className="w-4 h-4" />
                    <span>Unlock Vault</span>
                  </>
                )}
              </button>
            </form>

            <div className="pt-2 border-t border-neutral-800/80 flex items-center justify-between text-[11px] text-neutral-500">
              <span>PBKDF2-SHA-256 (600k rounds)</span>
              <button
                type="button"
                onClick={handleResetVault}
                className="text-neutral-500 hover:text-rose-400 transition"
              >
                Forgot passphrase? Reset Vault
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: Vault Unlocked - Full Interface */}
        {isUnlocked && (
          <div className="p-5 sm:p-6 space-y-6">
            {/* Navigation Tabs */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-neutral-800/80 pb-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('items')}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
                    activeTab === 'items'
                      ? 'bg-indigo-600/20 border border-indigo-500/40 text-indigo-300'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Encrypted Vault Items</span>
                  <span className="text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded-full">
                    {vaultItems?.length || 0}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('add')}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition ${
                    activeTab === 'add'
                      ? 'bg-indigo-600/20 border border-indigo-500/40 text-indigo-300'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Secure Item</span>
                </button>
              </div>

              {/* Status Pill */}
              <div className="flex items-center gap-2 text-[11px] text-neutral-400 bg-neutral-950/60 px-3 py-1.5 rounded-xl border border-neutral-800/80">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>AES-GCM Key in Volatile Memory</span>
              </div>
            </div>

            {/* TAB: Add Secure Item Form */}
            {activeTab === 'add' && (
              <div className="max-w-2xl mx-auto bg-neutral-950/60 border border-neutral-800 rounded-2xl p-5 sm:p-6 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-indigo-400" />
                    <span>Encrypt & Store Sensitive Data in Dexie</span>
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Data is encrypted client-side with AES-GCM (256-bit) and a unique 96-bit IV before saving to IndexedDB.
                  </p>
                </div>

                <form onSubmit={handleAddSecureItem} className="space-y-4 pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor={noteTitleId}
                        className="block text-xs font-medium text-neutral-300 mb-1"
                      >
                        Item Title
                      </label>
                      <input
                        id={noteTitleId}
                        type="text"
                        required
                        placeholder="e.g. Google Drive Private Notes / Passphrase"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        className="w-full text-xs bg-neutral-900 border border-neutral-700/80 rounded-xl px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={noteCategoryId}
                        className="block text-xs font-medium text-neutral-300 mb-1"
                      >
                        Category
                      </label>
                      <select
                        id={noteCategoryId}
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value as any)}
                        className="w-full text-xs bg-neutral-900 border border-neutral-700/80 rounded-xl px-3 py-2 text-neutral-200 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="note">Secure Note</option>
                        <option value="metadata">File Confidential Metadata</option>
                        <option value="credential">API / Access Credential</option>
                        <option value="tag">Confidential Tag</option>
                      </select>
                    </div>
                  </div>

                  {/* Optional File Association */}
                  <div>
                    <label
                      htmlFor={noteFileId}
                      className="block text-xs font-medium text-neutral-300 mb-1"
                    >
                      Associated Google Drive File (Optional)
                    </label>
                    <select
                      id={noteFileId}
                      value={selectedFileId}
                      onChange={(e) => setSelectedFileId(e.target.value)}
                      className="w-full text-xs bg-neutral-900 border border-neutral-700/80 rounded-xl px-3 py-2 text-neutral-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">None (Independent Note)</option>
                      {(cachedFiles || []).map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.name} ({file.mimeType.split('.').pop() || 'file'})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-neutral-500 mt-1">
                      Linking a file marks it as vault-locked in your local Dexie cache.
                    </p>
                  </div>

                  {/* Sensitive Content */}
                  <div>
                    <label
                      htmlFor={noteContentId}
                      className="block text-xs font-medium text-neutral-300 mb-1"
                    >
                      Secret Plaintext Content
                    </label>
                    <textarea
                      id={noteContentId}
                      required
                      rows={5}
                      placeholder="Enter sensitive personal notes, encryption keys, confidential meeting snippets, or access credentials..."
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      className="w-full text-xs bg-neutral-900 border border-neutral-700/80 rounded-xl p-3 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('items')}
                      className="px-3.5 py-2 rounded-xl border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-800 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isProcessing || !newTitle.trim() || !newContent.trim()}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-2 shadow-md transition"
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Encrypting...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Encrypt & Save to Dexie</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* TAB: Encrypted Items List */}
            {activeTab === 'items' && (
              <div className="space-y-4">
                {/* Search and Category Filter */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search vault items by title or category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full text-xs bg-neutral-950 border border-neutral-700/80 rounded-xl pl-9 pr-3 py-2 text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    {['all', 'note', 'metadata', 'credential', 'tag'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2.5 py-1 rounded-lg capitalize transition ${
                          categoryFilter === cat
                            ? 'bg-neutral-800 text-neutral-100 font-medium'
                            : 'text-neutral-400 hover:text-neutral-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Items List */}
                {filteredItems.length === 0 ? (
                  <div className="p-8 text-center bg-neutral-950/40 border border-neutral-800/80 rounded-2xl space-y-3">
                    <Shield className="w-10 h-10 text-neutral-600 mx-auto" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-neutral-300">No encrypted vault items found</p>
                      <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                        Add confidential notes, sensitive metadata, or credentials to encrypt them locally before storing in Dexie.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('add')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 text-xs font-medium hover:bg-indigo-600/30 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add First Secure Item</span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredItems.map((item) => {
                      const isDecrypted = !!decryptedCache[item.id];
                      const isViewingCipher = viewCiphertextId === item.id;
                      const associatedFile = cachedFiles?.find((f) => f.id === item.associatedFileId);

                      return (
                        <div
                          key={item.id}
                          className="bg-neutral-950/70 border border-neutral-800 hover:border-neutral-700/80 rounded-2xl p-4 space-y-3 flex flex-col justify-between transition shadow-sm"
                        >
                          <div className="space-y-2">
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="text-sm font-semibold text-neutral-100 flex items-center gap-2">
                                  <span>{item.title}</span>
                                  {item.associatedFileId && (
                                    <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/60 px-1.5 py-0.5 rounded">
                                      Linked to File
                                    </span>
                                  )}
                                </h4>
                                <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-400">
                                  <span className="capitalize px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">
                                    {item.category}
                                  </span>
                                  <span>•</span>
                                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                                  {associatedFile && (
                                    <>
                                      <span>•</span>
                                      <span className="text-neutral-400 truncate max-w-[150px]">
                                        {associatedFile.name}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item.id, item.title)}
                                className="text-neutral-500 hover:text-rose-400 p-1 rounded-lg hover:bg-neutral-900 transition"
                                title="Delete encrypted item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Content Display: Plaintext OR Ciphertext view */}
                            {isDecrypted ? (
                              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-200 text-xs font-mono whitespace-pre-wrap break-all relative group">
                                <div className="flex items-center justify-between text-[10px] text-emerald-400/80 pb-1.5 mb-1.5 border-b border-emerald-800/30">
                                  <span className="flex items-center gap-1 font-semibold">
                                    <Unlock className="w-3 h-3" /> Plaintext (Decrypted)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyPlaintext(item.id, decryptedCache[item.id])}
                                    className="flex items-center gap-1 text-emerald-300 hover:text-white px-1.5 py-0.5 rounded bg-emerald-900/60"
                                  >
                                    {copiedItemId === item.id ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-300" /> Copied!
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" /> Copy
                                      </>
                                    )}
                                  </button>
                                </div>
                                <div className="text-xs text-emerald-100 max-h-48 overflow-y-auto">
                                  {decryptedCache[item.id]}
                                </div>
                              </div>
                            ) : isViewingCipher ? (
                              <div className="p-3 rounded-xl bg-neutral-900 border border-neutral-700/80 text-[11px] font-mono text-neutral-300 space-y-2">
                                <div className="flex items-center justify-between text-[10px] text-neutral-400 pb-1 border-b border-neutral-800">
                                  <span className="flex items-center gap-1">
                                    <Lock className="w-3 h-3 text-amber-400" /> Raw AES-GCM Ciphertext
                                  </span>
                                  <span>Stored in Dexie</span>
                                </div>
                                <div className="space-y-1">
                                  <div className="text-[10px] text-neutral-500">Ciphertext (Base64):</div>
                                  <div className="text-neutral-300 break-all max-h-16 overflow-y-auto text-[10px] bg-neutral-950 p-1.5 rounded">
                                    {item.ciphertext}
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                  <div>
                                    <span className="text-neutral-500">IV (12 bytes):</span>
                                    <div className="text-neutral-300 truncate bg-neutral-950 p-1 rounded font-mono">
                                      {item.iv}
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-neutral-500">Salt (16 bytes):</span>
                                    <div className="text-neutral-300 truncate bg-neutral-950 p-1 rounded font-mono">
                                      {item.salt}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="p-3 rounded-xl bg-neutral-900/60 border border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
                                <div className="flex items-center gap-2">
                                  <Lock className="w-3.5 h-3.5 text-indigo-400" />
                                  <span className="font-mono text-[11px] text-neutral-500">
                                    {item.ciphertext.substring(0, 24)}... (Encrypted)
                                  </span>
                                </div>
                                <span className="text-[10px] bg-neutral-800/80 text-neutral-400 px-2 py-0.5 rounded">
                                  AES-GCM 256
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Card Actions Footer */}
                          <div className="pt-2 border-t border-neutral-800/60 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleDecrypt(item)}
                              disabled={decryptingItemId === item.id}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                                isDecrypted
                                  ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                                  : 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/30'
                              }`}
                            >
                              {decryptingItemId === item.id ? (
                                <>
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                  <span>Decrypting...</span>
                                </>
                              ) : isDecrypted ? (
                                <>
                                  <EyeOff className="w-3 h-3" />
                                  <span>Conceal</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3 h-3" />
                                  <span>Decrypt Plaintext</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => setViewCiphertextId(isViewingCipher ? null : item.id)}
                              className="text-[11px] text-neutral-400 hover:text-neutral-200 transition"
                            >
                              {isViewingCipher ? 'Hide Details' : 'Inspect Cipher'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
