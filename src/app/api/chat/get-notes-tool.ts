// src/app/api/chat/get-emails-tool.ts
import { loadNotes } from "@/app/search";
import { tool } from "ai";
import { z } from "zod";

export const getNotesTool = tool({
  description:
    "Fetch full content of specific notes by their IDs. Use this after searching/filtering to retrieve complete note contents.",
  inputSchema: z.object({
    ids: z
      .array(z.string())
      .describe("Array of note IDs to retrieve full content for"),
  }),
  execute: async ({ ids }) => {
    console.log("Get notes params:", { ids });

    const notes = await loadNotes();

    const results = notes.filter((note) => ids.includes(note.id));

    console.log(`Returning ${results.length} notes`);

    return {
      notes: results.map((note) => ({
        id: note.id,
        subject: note.subject,
        lastModified: note.lastModified,
        content: note.content,
      })),
    };
  },
});
