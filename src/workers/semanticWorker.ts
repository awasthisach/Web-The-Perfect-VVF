/// src/workers/semanticWorker.ts ///
import { pipeline, env } from '@xenova/transformers';

// Configuration for local Transformers.js execution
// Avoid fetching local model files from filesystem; use HuggingFace CDN cache
env.allowLocalModels = false;
env.useBrowserCache = true;

// Model identifier for compact, fast, high-quality sentence embeddings (384 dimensions)
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

// Lazy-loaded feature extraction pipeline singleton
let extractorPromise: Promise<any> | null = null;

async function getExtractor(onProgress?: (progress: any) => void) {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_NAME, {
      progress_callback: (p: any) => {
        if (onProgress) {
          onProgress(p);
        }
      },
    });
  }
  return extractorPromise;
}

/**
 * Calculates Cosine Similarity between two numerical vectors of equal length.
 * cos(theta) = (A • B) / (||A|| * ||B||)
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) return 0;
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

// Worker message handling
self.addEventListener('message', async (event: MessageEvent) => {
  const { id, type, payload } = event.data || {};

  try {
    switch (type) {
      case 'PING': {
        self.postMessage({ id, type: 'PONG', success: true });
        break;
      }

      case 'INIT_MODEL': {
        // Pre-warm the model and report download progress back to main thread
        await getExtractor((progress) => {
          self.postMessage({
            type: 'MODEL_PROGRESS',
            payload: progress,
          });
        });

        self.postMessage({
          id,
          type: 'INIT_MODEL_SUCCESS',
          success: true,
          payload: { model: MODEL_NAME, status: 'ready' },
        });
        break;
      }

      case 'GENERATE_EMBEDDING': {
        const text: string = payload?.text;
        if (!text || typeof text !== 'string') {
          throw new Error('Payload "text" must be a non-empty string.');
        }

        const extractor = await getExtractor();
        // Generate sentence embedding with mean pooling & normalization
        const output = await extractor(text, {
          pooling: 'mean',
          normalize: true,
        });

        // output.data is a Float32Array
        const embedding = Array.from(output.data as Float32Array);

        self.postMessage({
          id,
          type: 'GENERATE_EMBEDDING_SUCCESS',
          success: true,
          payload: {
            text,
            embedding,
            dimensions: embedding.length,
          },
        });
        break;
      }

      case 'BATCH_GENERATE_EMBEDDINGS': {
        const items: Array<{ id: string; text: string }> = payload?.items || [];
        const extractor = await getExtractor();
        const results: Array<{ id: string; embedding: number[] }> = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const output = await extractor(item.text, {
            pooling: 'mean',
            normalize: true,
          });
          results.push({
            id: item.id,
            embedding: Array.from(output.data as Float32Array),
          });

          // Post granular batch progress
          self.postMessage({
            type: 'BATCH_PROGRESS',
            payload: {
              completed: i + 1,
              total: items.length,
              currentId: item.id,
            },
          });
        }

        self.postMessage({
          id,
          type: 'BATCH_GENERATE_EMBEDDINGS_SUCCESS',
          success: true,
          payload: { results },
        });
        break;
      }

      case 'COMPUTE_SIMILARITY': {
        const vecA: number[] = payload?.vecA;
        const vecB: number[] = payload?.vecB;
        const score = cosineSimilarity(vecA, vecB);

        self.postMessage({
          id,
          type: 'COMPUTE_SIMILARITY_SUCCESS',
          success: true,
          payload: { score },
        });
        break;
      }

      case 'FIND_TOP_MATCHES': {
        // payload: { queryEmbedding: number[], targets: Array<{ id: string; embedding: number[] }>, topK?: number, minScore?: number }
        const queryEmbedding: number[] = payload?.queryEmbedding;
        const targets: Array<{ id: string; embedding: number[] }> = payload?.targets || [];
        const topK = payload?.topK || 20;
        const minScore = payload?.minScore ?? 0.15;

        if (!queryEmbedding) {
          throw new Error('queryEmbedding is required');
        }

        const scored = targets
          .filter((t) => t.embedding && t.embedding.length === queryEmbedding.length)
          .map((t) => ({
            id: t.id,
            score: cosineSimilarity(queryEmbedding, t.embedding),
          }))
          .filter((item) => item.score >= minScore)
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);

        self.postMessage({
          id,
          type: 'FIND_TOP_MATCHES_SUCCESS',
          success: true,
          payload: { matches: scored },
        });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error: any) {
    self.postMessage({
      id,
      type: 'ERROR',
      success: false,
      error: error?.message || String(error),
    });
  }
});
