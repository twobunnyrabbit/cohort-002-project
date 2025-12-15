import BM25 from "okapibm25";
import fs from "fs/promises";
import path from "path";
import { embed, embedMany, cosineSimilarity } from "ai";
import { google } from "@ai-sdk/google";

import {
  ensureEmbeddingsCacheDirectory,
  getCachedEmbedding,
  writeEmbeddingToCache,
} from "./api/embeddings";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Splitter } from 'llm-text-splitter';

export interface Note {
  id: string;
  subject: string;
  preview?: string;
  content: string;
  lastModified: string;
}

export type NoteChunk = {
  id: string;
  subject: string;
  chunk: string;
  index: number;
  totalChunks: number;
  lastModified: string;
};

function countTokens(text: string): number {
  return text.split(" ").length;
}

// src/app/search.ts
// const textSplitter = new RecursiveCharacterTextSplitter({
//   chunkSize: 1000,
//   chunkOverlap: 100,
//   separators: ["\n\n", "\n", " ", ""],
//   // lengthFunction: countTokens,
// });

const textSplitter = new Splitter({
  maxLength: 1000,
  overlap: 100,
  splitter: 'markdown'
});

/**
 * Splits notes into smaller chunks for more efficient processing and searching.
 *
 * This function takes an array of notes and uses a text splitter to break down
 * each note's content into smaller, overlapping chunks. Each chunk retains the
 * original note's metadata (id, subject, lastModified) along with chunk-specific
 * information (index within the note, total chunks count).
 *
 * Chunking is useful for:
 * - Improving search relevance by matching queries to specific sections
 * - Handling large documents that exceed context limits
 * - Providing more granular search results
 *
 * @param notes - Array of notes to be chunked
 * @returns Array of NoteChunk objects containing chunked content with metadata
 */
export const chunkNotes = async (notes: Note[]) => {
  
  // Initialize array to store all chunks from all notes
  const notesWithChunks: NoteChunk[] = [];

  // Process each note individually
  for (const note of notes) {
    // Split the note content into chunks using the configured text splitter
    // The splitter uses RecursiveCharacterTextSplitter with chunkSize=1000 and chunkOverlap=100
    // const chunks = await textSplitter.splitText(note.content);
    const chunks = await textSplitter.split(note.content);
    

    // Convert each chunk into a NoteChunk object with metadata
    chunks.forEach((chunk, chunkIndex) => {
      notesWithChunks.push({
        id: note.id, // Original note ID
        index: chunkIndex, // Position of this chunk within the note
        subject: note.subject, // Original note subject
        chunk, // The actual chunk content
        lastModified: note.lastModified, // Original note modification date
        totalChunks: chunks.length, // Total number of chunks for this note
      });
    });
  }

  
  return notesWithChunks;
};

export const noteChunkToText = (note: NoteChunk) => {
  return `${note.subject} ${note.chunk}`;
};

const RRF_K = 60;

// ADDED: Combines multiple ranking lists using position-based scoring
export function reciprocalRankFusion(
  rankings: { note: NoteChunk; score: number }[][]
): { note: NoteChunk; score: number }[] {
  const rrfScores = new Map<string, number>();
  const noteMap = new Map<string, NoteChunk>();

  // Process each ranking list (BM25 and embeddings)
  rankings.forEach((ranking) => {
    ranking.forEach((item, rank) => {
      const noteChunkId = `${item.note.id}-${item.note.index}`;
      const currentScore = rrfScores.get(item.note.id) || 0;

      // Position-based scoring: 1/(k+rank)
      const contribution = 1 / (RRF_K + rank);
      rrfScores.set(noteChunkId, currentScore + contribution);

      noteMap.set(noteChunkId, item.note);
    });
  });

  // Sort by combined RRF score descending
  return Array.from(rrfScores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([noteChunkId, score]) => ({
      score,
      note: noteMap.get(noteChunkId)!,
    }));
}

// src/app/search.ts
// ADDED: Combines BM25 and embeddings search using RRF
export const searchWithRRF = async (query: string, notes: Note[]) => {
  
  
  const noteChunks = await chunkNotes(notes);

  
  const bm25Ranking = await searchWithBM25(
    query.toLowerCase().split(" "),
    noteChunks
  );
  
  const embeddingsRanking = await searchWithEmbeddings(query, noteChunks);
  const rrfRanking = reciprocalRankFusion([bm25Ranking, embeddingsRanking]);

  
  return rrfRanking;
};

export async function searchWithEmbeddings(
  query: string,
  noteChunks: NoteChunk[]
) {
  // load cached embeddings
  const notesEmbeddings = await loadOrGenerateEmbeddings(noteChunks);

  // generate query embedding
  const { embedding: embeddingQuery } = await embed({
    model: google.textEmbeddingModel("text-embedding-004"),
    value: query,
  });

  // calculate cosine similarity scores
  const results = notesEmbeddings.map(({ id, embedding }) => {
    const note = noteChunks.find((e) => e.id == id)!;
    const score = cosineSimilarity(embeddingQuery, embedding);
    return { score, note };
  });

  // sort by simiarlity descending
  return results.sort((a, b) => b.score - a.score);
}

// src/app/search.ts
// ADDED: Load embeddings from cache or generate new ones
export async function loadOrGenerateEmbeddings(
  noteChunks: NoteChunk[]
): Promise<{ id: string; embedding: number[] }[]> {
  // Ensure cache directory exists
  // await fs.mkdir(CACHE_DIR, { recursive: true });
  await ensureEmbeddingsCacheDirectory();

  const results: { id: string; embedding: number[] }[] = [];
  const uncachedNoteChunks: NoteChunk[] = [];

  // Check cache for each note
  for (const noteChunk of noteChunks) {
    const cachedEmbedding = await getCachedEmbedding(
      noteChunkToText(noteChunk)
    );
    if (cachedEmbedding) {
      results.push({ id: noteChunk.id, embedding: cachedEmbedding });
    } else {
      uncachedNoteChunks.push(noteChunk);
    }
  }

  // Generate embeddings for uncached notes in batches of 99
  if (uncachedNoteChunks.length > 0) {
    

    const BATCH_SIZE = 99; //99
    for (let i = 0; i < uncachedNoteChunks.length; i += BATCH_SIZE) {
      const batch = uncachedNoteChunks.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          uncachedNoteChunks.length / BATCH_SIZE
        )}`
      );

      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel("text-embedding-004"),
        values: batch.map((e) => noteChunkToText(e)),
      });

      // Write batch to cache
      for (let j = 0; j < batch.length; j++) {
        const note = batch[j];
        const embedding = embeddings[j];

        await writeEmbeddingToCache(noteChunkToText(note), embedding);

        results.push({ id: note.id, embedding });
      }
    }
  }

  return results;
}

export async function searchWithBM25(
  keywords: string[],
  noteChunks: NoteChunk[]
) {
  // Combine subject + body for richer text corpus
  const corpus = noteChunks.map((noteChunk) => noteChunkToText(noteChunk));

  // BM25 returns score array matching corpus order
  const scores: number[] = (BM25 as any)(corpus, keywords);

  // Map scores to notes, sort descending
  return scores
    .map((score, idx) => ({ score, note: noteChunks[idx] }))
    .sort((a, b) => b.score - a.score);
}

export async function loadNotes(): Promise<Note[]> {
  const filePath = path.join(process.cwd(), "data", "obsidian-notes.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}
