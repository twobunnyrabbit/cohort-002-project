// src/app/api/chat/search-tool.ts
import {
  chunkNotes,
  loadNotes,
  reciprocalRankFusion,
  searchWithBM25,
  searchWithEmbeddings,
} from "@/app/search";
import { convertToModelMessages, tool, UIMessage } from "ai";
import { z } from "zod";
import { rerankNotes } from "@/app/rerank";

const NUMBER_PASSED_TO_RERANKER = 30;

export const searchTool = (messages: UIMessage[]) =>
  tool({
    description:
      "Search notes using both keyword and semantic search. Returns metadata with snippets only - use getNotes tool to fetch full content of specific notes.",
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
      const bm25Results = keywords
        ? await searchWithBM25(keywords, noteChunks)
        : [];
      const embeddingResults = searchQuery
        ? await searchWithEmbeddings(searchQuery, noteChunks)
        : [];

      // Combine results using reciprocal rank fusion
      const rrfResults = reciprocalRankFusion([
        bm25Results.slice(0, NUMBER_PASSED_TO_RERANKER),
        embeddingResults.slice(0, NUMBER_PASSED_TO_RERANKER),
      ]);

      const conversationHistory = convertToModelMessages(messages).filter(
        (m) => m.role === "user" || m.role === "assistant"
      );

      const query = [keywords?.join(" "), searchQuery]
        .filter(Boolean)
        .join(" ");
      const rerankedResults = await rerankNotes(
        rrfResults.slice(0, NUMBER_PASSED_TO_RERANKER),
        query,
        conversationHistory
      );

      const topNotes = rerankedResults.map((r) => {
        // get full note to extract id
        const fullNote = notes.find((e) => e.id === r.note.id);
        const snippet =
          r.note.chunk.slice(0, 150).trim() +
          (r.note.chunk.length > 150 ? "..." : "");

        return {
          id: r.note.id,
          subject: r.note.subject,
          lastModified: r.note.lastModified,
          score: r.score,
          snippet,
        };
      });

      console.log("Top notes:", topNotes.length);

      return {
        notes: topNotes,
      };
    },
  });
