import BM25 from "okapibm25";
import fs from "fs/promises";
import path from "path";
import { embed, embedMany, cosineSimilarity } from 'ai';
import { google } from '@ai-sdk/google';

export interface Note {
  id: string;
  subject: string;
  preview?: string;
  content: string;
  lastModified: string;
}

// src/app/search.ts
// ADDED: Cache configuration for embeddings
const CACHE_DIR = path.join(process.cwd(), 'data', 'embeddings');

const CACHE_KEY = 'google-text-embedding-004';

const getEmbeddingFilePath = (id: string) =>
  path.join(CACHE_DIR, `${CACHE_KEY}-${id}.json`);

export async function searchWithEmbeddings(query: string, notes: Note[]) {
  // console.log(`query: ${query}`);
  // load cached embeddings
  const notesEmbeddings = await loadOrGenerateEmbeddings(notes);
  // console.log(notesEmbeddings.length);

  // generate query embedding
  const { embedding: embeddingQuery} = await embed({
    model: google.textEmbeddingModel('text-embedding-004'),
    value: query
  });

  // console.log(embeddingQuery);

  // calculate cosine similarity scores
  const results = notesEmbeddings.map(({id, embedding }) => {
    const note = notes.find((e) => e.id == id)!;
    const score = cosineSimilarity(embeddingQuery, embedding);
    // console.log(`score: ${score} id: ${id}`);
    return { score, note };
  });
  console.log('Results: ', results.length);

  // sort by simiarlity descending
  return results.sort((a, b) => b.score - a.score);
}

// src/app/search.ts
// ADDED: Load embeddings from cache or generate new ones
export async function loadOrGenerateEmbeddings(
  notes: Note[],
): Promise<{ id: string; embedding: number[] }[]> {
  // Ensure cache directory exists
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const results: { id: string; embedding: number[] }[] = [];
  const uncachedNotes: Note[] = [];

  // Check cache for each note
  for (const note of notes) {
    try {
      const cached = await fs.readFile(
        getEmbeddingFilePath(note.id),
        'utf-8',
      );
      const data = JSON.parse(cached);
      results.push({ id: note.id, embedding: data.embedding });
    } catch {
      // Cache miss - need to generate
      uncachedNotes.push(note);
    }
  }

  // Generate embeddings for uncached notes in batches of 99
  if (uncachedNotes.length > 0) {
    console.log(
      `Generating embeddings for ${uncachedNotes.length} notes`,
    );

    const BATCH_SIZE = 99;
    for (let i = 0; i < uncachedNotes.length; i += BATCH_SIZE) {
      const batch = uncachedNotes.slice(i, i + BATCH_SIZE);
      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          uncachedNotes.length / BATCH_SIZE,
        )}`,
      );

      const { embeddings } = await embedMany({
        model: google.textEmbeddingModel('text-embedding-004'),
        values: batch.map((e) => `${e.subject} ${e.content}`),
      });

      // Write batch to cache
      for (let j = 0; j < batch.length; j++) {
        const note = batch[j];
        const embedding = embeddings[j];

        await fs.writeFile(
          getEmbeddingFilePath(note.id),
          JSON.stringify({ id: note.id, embedding }),
        );

        results.push({ id: note.id, embedding });
      }
    }
  }

  return results;
}

export async function searchWithBM25(keywords: string[], notes: Note[]) {
  // Combine subject + body for richer text corpus
  const corpus = notes.map((note) => `${note.subject} ${note.content}`);

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
