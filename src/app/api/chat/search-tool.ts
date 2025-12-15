// src/app/api/chat/search-tool.ts
import {
  chunkNotes,
  loadNotes,
  reciprocalRankFusion,
  searchWithBM25,
  searchWithEmbeddings,
} from "@/app/search";
import { tool } from "ai";
import { z } from "zod";

export const searchTool = tool({
  description:
    "Search notes using both keyword and semantic search. Returns most relevant notes ranked by reciprocal rank fusion.",
  inputSchema: z.object({
    keywords: z
      .array(z.string())
      .describe(
        "Exact keywords for BM25 search (names, amounts, specific terms)"
      )
      .optional(),
    searchQuery: z
      .string()
      .describe(
        "Natural language query for semantic search (broader concepts)"
      ),
  }),
  execute: async ({ keywords, searchQuery }) => {
    console.log("Keywords:", keywords);
    console.log("Search query:", searchQuery);

    const notes = await loadNotes();
    const noteChunks = await chunkNotes(notes);

    // Perform BM25 and embedding searches
    const bm25Results = keywords ? await searchWithBM25(keywords, noteChunks) : [];
    const embeddingResults = searchQuery
      ? await searchWithEmbeddings(searchQuery, noteChunks)
      : [];

    // Combine results using reciprocal rank fusion
    const rrResults = reciprocalRankFusion([
      bm25Results.slice(0, 30),
      embeddingResults.slice(0, 30),
    ]);

    // Filter and map top results
    const topNotes = rrResults
      .slice(0, 10)
      .filter((r) => r.score > 0)
      .map((r) => ({
        id: r.note.id,
        subject: r.note.subject,
        content: r.note.chunk,
        lastModified: r.note.lastModified,
        score: r.score,
      }));

    return {
      notes: topNotes,
    };
  },
});
