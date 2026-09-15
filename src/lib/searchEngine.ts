/// src/lib/searchEngine.ts ///
import { db, type FileRecord } from './db';

/**
 * Types and interfaces for Hybrid Search
 */
export interface SearchResultItem {
  file: FileRecord;
  score: number;
  matchType: 'exact_substring' | 'semantic' | 'hybrid';
  similarityPercentage: number;
  matchedField?: 'name' | 'mimeType' | 'md5Checksum';
}

export interface ModelProgressInfo {
  status: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

// Singleton Web Worker instance management
let semanticWorker: Worker | null = null;
let isWorkerReady = false;
let initPromise: Promise<boolean> | null = null;
const progressCallbacks = new Set<(info: ModelProgressInfo) => void>();

/**
 * Get or initialize the Semantic Web Worker
 */
export function getSemanticWorker(): Worker {
  if (!semanticWorker) {
    // Correct Vite module worker instantiation
    semanticWorker = new Worker(
      new URL('../workers/semanticWorker.ts', import.meta.url),
      { type: 'module' }
    );

    semanticWorker.addEventListener('message', (event) => {
      const { type, payload } = event.data || {};
      if (type === 'MODEL_PROGRESS' || type === 'BATCH_PROGRESS') {
        progressCallbacks.forEach((cb) => {
          try {
            cb(payload);
          } catch (e) {
            console.error('Progress callback error:', e);
          }
        });
      }
    });
  }
  return semanticWorker;
}

/**
 * Subscribe to model download / embedding generation progress
 */
export function subscribeModelProgress(callback: (info: ModelProgressInfo) => void): () => void {
  progressCallbacks.add(callback);
  return () => {
    progressCallbacks.delete(callback);
  };
}

/**
 * Helper to perform RPC over worker postMessage
 */
function sendWorkerRequest<T = any>(type: string, payload?: any): Promise<T> {
  const worker = getSemanticWorker();
  const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (event.data?.id === id) {
        worker.removeEventListener('message', handler);
        if (event.data.success) {
          resolve(event.data.payload);
        } else {
          reject(new Error(event.data.error || 'Worker request failed'));
        }
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ id, type, payload });
  });
}

/**
 * Pre-warm the local Transformers model
 */
export async function initializeSemanticModel(onProgress?: (info: ModelProgressInfo) => void): Promise<boolean> {
  if (isWorkerReady) return true;
  if (initPromise) return initPromise;

  let unsub: (() => void) | null = null;
  if (onProgress) {
    unsub = subscribeModelProgress(onProgress);
  }

  initPromise = (async () => {
    try {
      await sendWorkerRequest('INIT_MODEL');
      isWorkerReady = true;
      return true;
    } catch (err) {
      console.error('Failed to initialize local semantic model:', err);
      return false;
    } finally {
      if (unsub) unsub();
    }
  })();

  return initPromise;
}

/**
 * Generate embedding for a single string using local Web Worker
 */
export async function generateTextEmbedding(text: string): Promise<number[]> {
  const res = await sendWorkerRequest<{ text: string; embedding: number[] }>('GENERATE_EMBEDDING', { text });
  return res.embedding;
}

/**
 * Compute cosine similarity between two vectors using Web Worker
 */
export async function computeVectorSimilarity(vecA: number[], vecB: number[]): Promise<number> {
  const res = await sendWorkerRequest<{ score: number }>('COMPUTE_SIMILARITY', { vecA, vecB });
  return res.score;
}

/**
 * Embed all cached files that do not currently have embeddings.
 * Saves directly into db.files to persist vectors in IndexedDB.
 */
export async function ensureFilesEmbedded(
  onProgress?: (completed: number, total: number, fileName: string) => void
): Promise<number> {
  // Query files that need embeddings
  const allFiles = await db.files.filter((f) => !f.trashed).toArray();
  const unembedded = allFiles.filter((f) => !f.embedding || f.embedding.length === 0);

  if (unembedded.length === 0) {
    return 0;
  }

  const itemsToEmbed = unembedded.map((f) => ({
    id: f.id,
    text: `${f.name} (${f.mimeType.replace('application/vnd.google-apps.', '')})`,
  }));

  let completedCount = 0;
  const total = itemsToEmbed.length;

  const unsub = subscribeModelProgress((info: any) => {
    if (info?.completed && info?.total) {
      completedCount = info.completed;
      const file = unembedded.find((f) => f.id === info.currentId);
      if (onProgress && file) {
        onProgress(completedCount, total, file.name);
      }
    }
  });

  try {
    const res = await sendWorkerRequest<{ results: Array<{ id: string; embedding: number[] }> }>(
      'BATCH_GENERATE_EMBEDDINGS',
      { items: itemsToEmbed }
    );

    // Bulk update files in Dexie
    for (const result of res.results) {
      await db.files.update(result.id, {
        embedding: result.embedding,
        hasEmbedding: true,
      });
    }

    await db.logAction(
      'EMBED_FILES_BATCH',
      'SYSTEM',
      undefined,
      `Generated embeddings for ${res.results.length} files with Transformers.js.`
    );

    return res.results.length;
  } finally {
    unsub();
  }
}

/**
 * Tier 1: Local Dexie substring search
 */
export async function searchLocalDexie(query: string): Promise<SearchResultItem[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const allFiles = await db.files.filter((f) => !f.trashed).toArray();

  const results: SearchResultItem[] = [];

  for (const file of allFiles) {
    const nameMatch = file.name.toLowerCase().includes(trimmed);
    const mimeMatch = file.mimeType.toLowerCase().includes(trimmed);
    const checksumMatch = file.md5Checksum ? file.md5Checksum.toLowerCase().includes(trimmed) : false;

    if (nameMatch || mimeMatch || checksumMatch) {
      // Score calculation: higher if exact start of filename
      let score = 0.6;
      if (file.name.toLowerCase() === trimmed) score = 1.0;
      else if (file.name.toLowerCase().startsWith(trimmed)) score = 0.85;

      results.push({
        file,
        score,
        matchType: 'exact_substring',
        similarityPercentage: Math.round(score * 100),
        matchedField: nameMatch ? 'name' : mimeMatch ? 'mimeType' : 'md5Checksum',
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Tier 2: Semantic Search with local embeddings & Cosine Similarity
 */
export async function searchSemantic(
  query: string,
  minSimilarity: number = 0.25,
  topK: number = 25
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Generate embedding for search query
  const queryEmbedding = await generateTextEmbedding(trimmed);

  // Collect existing file embeddings
  const allFiles = await db.files.filter((f) => !f.trashed).toArray();
  const targets = allFiles
    .filter((f) => Array.isArray(f.embedding) && f.embedding.length > 0)
    .map((f) => ({
      id: f.id,
      embedding: f.embedding as number[],
    }));

  if (targets.length === 0) {
    return [];
  }

  // Ask worker to compute top matches
  const matchResult = await sendWorkerRequest<{ matches: Array<{ id: string; score: number }> }>(
    'FIND_TOP_MATCHES',
    {
      queryEmbedding,
      targets,
      topK,
      minScore: minSimilarity,
    }
  );

  const fileMap = new Map(allFiles.map((f) => [f.id, f]));
  const results: SearchResultItem[] = [];

  for (const m of matchResult.matches) {
    const file = fileMap.get(m.id);
    if (file) {
      results.push({
        file,
        score: m.score,
        matchType: 'semantic',
        similarityPercentage: Math.round(m.score * 100),
        matchedField: 'name',
      });
    }
  }

  return results;
}

/**
 * Hybrid Search: Merges Tier 1 (Substring) and Tier 2 (Semantic)
 * Uses reciprocal rank fusion and semantic similarity weighting.
 */
export async function searchHybrid(
  query: string,
  options?: {
    semanticWeight?: number; // default 0.5
    minSimilarity?: number;
    topK?: number;
  }
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const semanticWeight = options?.semanticWeight ?? 0.5;
  const keywordWeight = 1.0 - semanticWeight;

  // Run Tier 1 and Tier 2 concurrently
  const [lexicalResults, semanticResults] = await Promise.all([
    searchLocalDexie(trimmed),
    searchSemantic(trimmed, options?.minSimilarity ?? 0.2, options?.topK ?? 30).catch((err) => {
      console.warn('Semantic search tier fallback:', err);
      return [] as SearchResultItem[];
    }),
  ]);

  const map = new Map<
    string,
    {
      file: FileRecord;
      lexicalScore: number;
      semanticScore: number;
      matchedField?: 'name' | 'mimeType' | 'md5Checksum';
    }
  >();

  // Add lexical results
  for (const item of lexicalResults) {
    map.set(item.file.id, {
      file: item.file,
      lexicalScore: item.score,
      semanticScore: 0,
      matchedField: item.matchedField,
    });
  }

  // Add semantic results
  for (const item of semanticResults) {
    const existing = map.get(item.file.id);
    if (existing) {
      existing.semanticScore = item.score;
    } else {
      map.set(item.file.id, {
        file: item.file,
        lexicalScore: 0,
        semanticScore: item.score,
        matchedField: 'name',
      });
    }
  }

  const combined: SearchResultItem[] = [];

  for (const val of map.values()) {
    let finalScore: number;
    let matchType: SearchResultItem['matchType'];

    if (val.lexicalScore > 0 && val.semanticScore > 0) {
      matchType = 'hybrid';
      finalScore = val.lexicalScore * keywordWeight + val.semanticScore * semanticWeight;
    } else if (val.semanticScore > 0) {
      matchType = 'semantic';
      finalScore = val.semanticScore;
    } else {
      matchType = 'exact_substring';
      finalScore = val.lexicalScore;
    }

    combined.push({
      file: val.file,
      score: finalScore,
      matchType,
      similarityPercentage: Math.round(finalScore * 100),
      matchedField: val.matchedField,
    });
  }

  return combined.sort((a, b) => b.score - a.score);
}
