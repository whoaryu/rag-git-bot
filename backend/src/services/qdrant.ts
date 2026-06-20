import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { Chunk } from './chunker.js';

dotenv.config();

const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
console.log(`Initializing Qdrant client at: ${qdrantUrl}`);

export const qdrantClient = new QdrantClient({
  url: qdrantUrl,
});

export function getCollectionName(repoId: number | string): string {
  return `codebase_${repoId}`;
}

export async function ensureCollectionExists(collectionName: string): Promise<void> {
  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some((c) => c.name === collectionName);
    
    if (!exists) {
      console.log(`Creating Qdrant collection: ${collectionName}`);
      await qdrantClient.createCollection(collectionName, {
        vectors: {
          size: 768, // Gemini text-embedding-004 dimensions
          distance: 'Cosine',
        },
      });
      console.log(`Collection ${collectionName} created successfully.`);
    }
  } catch (error) {
    console.error(`Error ensuring Qdrant collection ${collectionName} exists:`, error);
    throw error;
  }
}

export async function upsertChunks(
  repoId: number | string,
  chunks: Chunk[],
  embeddings: number[][]
): Promise<void> {
  const collectionName = getCollectionName(repoId);
  await ensureCollectionExists(collectionName);

  const points = chunks.map((chunk, index) => {
    return {
      id: crypto.randomUUID(),
      vector: embeddings[index],
      payload: {
        repo_id: String(repoId),
        file_path: chunk.filePath,
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        symbol_name: chunk.symbolName,
        symbol_type: chunk.symbolType,
        content: chunk.content,
        language: chunk.language,
        indexed_at: new Date().toISOString(),
      },
    };
  });

  try {
    console.log(`Upserting ${points.length} points to Qdrant collection ${collectionName}...`);
    // Batch in chunks of 100 to avoid huge HTTP payloads if repo is very large
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await qdrantClient.upsert(collectionName, {
        points: batch,
      });
    }
    console.log(`Successfully indexed ${points.length} points.`);
  } catch (error) {
    console.error(`Failed to upsert points into collection ${collectionName}:`, error);
    throw error;
  }
}

export async function searchSimilarChunks(
  repoId: number | string,
  queryVector: number[],
  limit = 5
): Promise<any[]> {
  const collectionName = getCollectionName(repoId);
  await ensureCollectionExists(collectionName);

  try {
    const results = await qdrantClient.search(collectionName, {
      vector: queryVector,
      limit,
      with_payload: true,
    });
    return results.map((r) => r.payload);
  } catch (error) {
    console.error(`Error searching Qdrant collection ${collectionName}:`, error);
    throw error;
  }
}

export async function deleteChunksByFilePath(
  repoId: number | string,
  filePath: string
): Promise<void> {
  const collectionName = getCollectionName(repoId);
  await ensureCollectionExists(collectionName);

  try {
    console.log(`Deleting old embeddings for file ${filePath} in ${collectionName}...`);
    await qdrantClient.delete(collectionName, {
      filter: {
        must: [
          {
            key: 'file_path',
            match: { value: filePath },
          },
        ],
      },
    });
    console.log(`Deleted points matching path ${filePath} successfully.`);
  } catch (error) {
    console.error(`Failed to delete points matching path ${filePath}:`, error);
    throw error;
  }
}

export async function deleteCollection(repoId: number | string): Promise<void> {
  const collectionName = getCollectionName(repoId);
  try {
    console.log(`Deleting Qdrant collection: ${collectionName}`);
    await qdrantClient.deleteCollection(collectionName);
    console.log(`Deleted collection ${collectionName} successfully.`);
  } catch (error) {
    console.error(`Failed to delete collection ${collectionName}:`, error);
  }
}
