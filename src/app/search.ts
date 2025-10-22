import BM25 from "okapibm25";
import fs from "fs/promises";
import path from "path";

export interface Note {
  id: string;
  subject: string;
  preview?: string;
  content: string;
  lastModified: string;
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
