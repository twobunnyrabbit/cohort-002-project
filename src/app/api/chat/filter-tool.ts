// src/app/api/chat/filter-tool.ts
import { loadNotes } from "@/app/search";
import { tool } from "ai";
import { z } from "zod";

// ADDED: New tool for filtering emails by exact criteria
export const filterNotesTool = tool({
  description:
    "Filter notes by exact criteria like subject, date range, or text content. Use this for precise filtering (e.g., 'notes about grammar', 'notes before 2024-01-01', 'notes containing code samples for a specific language').",
  inputSchema: z.object({
    subject: z
      .string()
      .describe("Filter by subject (partial match, case-insensitive)")
      .optional(),
    contains: z
      .string()
      .describe(
        "Filter by text in subject or body (partial match, case-insensitive)"
      )
      .optional(),
    before: z
      .string()
      .describe(
        "Filter notes before this ISO 8601 timestamp (e.g., '2024-01-01T00:00:00Z')"
      )
      .optional(),
    after: z
      .string()
      .describe(
        "Filter notes after this ISO 8601 timestamp (e.g., '2024-01-01T00:00:00Z')"
      )
      .optional(),
    limit: z
      .number()
      .describe("Maximum number of results to return")
      .default(10),
  }),
  execute: async ({ subject, contains, before, after, limit }) => {
    console.log("Filter params:", {
      subject,
      contains,
      before,
      after,
      limit,
    });

    const notes = await loadNotes();

    let filtered = notes;

    if (subject) {
      const lowerFrom = subject.toLowerCase();
      filtered = filtered.filter((note) =>
        note.subject.toLowerCase().includes(lowerFrom)
      );
    }

    if (contains) {
      const lowerContains = contains.toLowerCase();
      filtered = filtered.filter(
        (note) =>
          note.subject.toLowerCase().includes(lowerContains) ||
          note.content.toLowerCase().includes(lowerContains)
      );
    }

    if (before) {
      filtered = filtered.filter((note) => note.lastModified < before);
    }

    if (after) {
      filtered = filtered.filter((note) => note.lastModified > after);
    }

    // CHANGED: Apply limit and return results
    const results = filtered.slice(0, limit);

    console.log(
      `Filtered ${filtered.length} notes, returning ${results.length}`
    );

    return {
      notes: filtered.map((note) => ({
        id: note.id,
        subject: note.subject,
        content: note.content,
        lastModified: note.lastModified,
      })),
    };
  },
});
