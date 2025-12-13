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

// src/app/search.ts
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 100,
  separators: ["\n\n", "\n", " ", ""],
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
    const chunks = await textSplitter.splitText(note.content);

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

export const noteToText = (note: Note) => {
  return `${note.subject} ${note.content}`;
};

const RRF_K = 60;

// ADDED: Combines multiple ranking lists using position-based scoring
export function reciprocalRankFusion(
  rankings: { note: Note; score: number }[][]
): { note: Note; score: number }[] {
  const rrfScores = new Map<string, number>();
  const noteMap = new Map<string, Note>();

  // Process each ranking list (BM25 and embeddings)
  rankings.forEach((ranking) => {
    ranking.forEach((item, rank) => {
      const currentScore = rrfScores.get(item.note.id) || 0;

      // Position-based scoring: 1/(k+rank)
      const contribution = 1 / (RRF_K + rank);
      rrfScores.set(item.note.id, currentScore + contribution);

      noteMap.set(item.note.id, item.note);
    });
  });

  // Sort by combined RRF score descending
  return Array.from(rrfScores.entries())
    .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
    .map(([noteId, score]) => ({
      score,
      note: noteMap.get(noteId)!,
    }));
}

// src/app/search.ts
// ADDED: Combines BM25 and embeddings search using RRF
export const searchWithRRF = async (query: string, notes: Note[]) => {
  const bm25Ranking = await searchWithBM25(
    query.toLowerCase().split(" "),
    notes
  );
  const embeddingsRanking = await searchWithEmbeddings(query, notes);
  const rrfRanking = reciprocalRankFusion([bm25Ranking, embeddingsRanking]);
  return rrfRanking;
};

export async function searchWithEmbeddings(query: string, notes: Note[]) {
  // console.log(`query: ${query}`);
  // load cached embeddings
  const notesEmbeddings = await loadOrGenerateEmbeddings(notes);
  // console.log(notesEmbeddings.length);

  // generate query embedding
  const { embedding: embeddingQuery } = await embed({
    model: google.textEmbeddingModel("text-embedding-004"),
    value: query,
  });

  // console.log(embeddingQuery);

  // calculate cosine similarity scores
  const results = notesEmbeddings.map(({ id, embedding }) => {
    const note = notes.find((e) => e.id == id)!;
    const score = cosineSimilarity(embeddingQuery, embedding);
    // console.log(`score: ${score} id: ${id}`);
    return { score, note };
  });
  // console.log('Results: ', results.length);

  // sort by simiarlity descending
  return results.sort((a, b) => b.score - a.score);
}

// src/app/search.ts
// ADDED: Load embeddings from cache or generate new ones
export async function loadOrGenerateEmbeddings(
  notes: Note[]
): Promise<{ id: string; embedding: number[] }[]> {
  // Ensure cache directory exists
  // await fs.mkdir(CACHE_DIR, { recursive: true });
  await ensureEmbeddingsCacheDirectory();

  const results: { id: string; embedding: number[] }[] = [];
  const uncachedNotes: Note[] = [];

  // Check cache for each note
  for (const note of notes) {
    const cachedEmbedding = await getCachedEmbedding(noteToText(note));
    if (cachedEmbedding) {
      results.push({ id: note.id, embedding: cachedEmbedding });
    } else {
      uncachedNotes.push(note);
    }
  }

  // Generate embeddings for uncached notes in batches of 99
  if (uncachedNotes.length > 0) {
    console.log(`Generating embeddings for ${uncachedNotes.length} notes`);

    const BATCH_SIZE = 99;
    for (let i = 0; i < uncachedNotes.length; i += BATCH_SIZE) {
      const batch = uncachedNotes.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          uncachedNotes.length / BATCH_SIZE
        )}`
      );

      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel("text-embedding-004"),
        values: batch.map((e) => noteToText(e)),
      });

      // Write batch to cache
      for (let j = 0; j < batch.length; j++) {
        const note = batch[j];
        const embedding = embeddings[j];

        await writeEmbeddingToCache(noteToText(note), embedding);

        results.push({ id: note.id, embedding });
      }
    }
  }

  return results;
}

export async function searchWithBM25(keywords: string[], notes: Note[]) {
  // Combine subject + body for richer text corpus
  const corpus = notes.map((note) => noteToText(note));

  // BM25 returns score array matching corpus order
  const scores: number[] = (BM25 as any)(corpus, keywords);

  // Map scores to notes, sort descending
  return scores
    .map((score, idx) => ({ score, note: notes[idx] }))
    .sort((a, b) => b.score - a.score);
}

export async function loadNotes(): Promise<Note[]> {
  const filePath = path.join(process.cwd(), "data", "obsidian-notes.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}
