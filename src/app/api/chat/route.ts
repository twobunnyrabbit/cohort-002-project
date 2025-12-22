import {
  appendToChatMessages,
  createChat,
  DB,
  getChat,
  updateChatTitle,
} from "@/lib/persistence-layer";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  InferUITools,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  UIMessage,
} from "ai";
import { nanoid } from "nanoid";
import { generateTitleForChat } from "./generate-title";
import { searchTool } from "./search-tool";
import { filterNotesTool } from "./filter-tool";
import { getNotesTool } from "./get-notes-tool";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export type MyMessage = UIMessage<
  never,
  {
    "frontend-action": "refresh-sidebar";
  },
  InferUITools<ReturnType<typeof getTools>>
>;

const getTools = (messages: UIMessage[]) => ({
  search: searchTool(messages),
  filterNotes: filterNotesTool,
  getNotes: getNotesTool,
});

export async function POST(req: Request) {
  const body: {
    messages: UIMessage[];
    id: string;
  } = await req.json();

  const chatId = body.id;

  const validatedMessagesResult = await safeValidateUIMessages<MyMessage>({
    messages: body.messages,
  });

  if (!validatedMessagesResult.success) {
    return new Response(validatedMessagesResult.error.message, { status: 400 });
  }

  const messages = validatedMessagesResult.data;

  let chat = await getChat(chatId);
  const mostRecentMessage = messages[messages.length - 1];

  if (!mostRecentMessage) {
    return new Response("No messages provided", { status: 400 });
  }

  if (mostRecentMessage.role !== "user") {
    return new Response("Last message must be from the user", {
      status: 400,
    });
  }

  const stream = createUIMessageStream<MyMessage>({
    execute: async ({ writer }) => {
      let generateTitlePromise: Promise<void> | undefined = undefined;

      if (!chat) {
        const newChat = await createChat({
          id: chatId,
          title: "Generating title...",
          initialMessages: messages,
        });
        chat = newChat;

        writer.write({
          type: "data-frontend-action",
          data: "refresh-sidebar",
          transient: true,
        });

        generateTitlePromise = generateTitleForChat(messages)
          .then((title) => {
            return updateChatTitle(chatId, title);
          })
          .then(() => {
            writer.write({
              type: "data-frontend-action",
              data: "refresh-sidebar",
              transient: true,
            });
          });
      } else {
        await appendToChatMessages(chatId, [mostRecentMessage]);
      }

      const result = streamText({
        model: google("gemini-2.5-flash"),
        messages: convertToModelMessages(messages),
        // CHANGED: Restructured system prompt with clear sections
        system: `
<task-context>
You are an note assistant that helps users find and understand information from their notes.
</task-context>

<rules>
- You have THREE tools available: 'search', 'filterNotes', and 'getNotes'
- Follow this multi-step workflow for token efficiency:

  STEP 1 - Browse metadata:
  USE 'filterNotes' when the user wants to:
  - Find notes on subject (e.g., "notes about dementia"")
  - Filter by date ranges (e.g., "notes before January 2024", "notes after last week")
  - Find notes containing exact text (e.g., "notes containing 'gerunds'")
  - Any combination of precise filtering criteria

  USE 'search' when the user wants to:
  - Find information semantically (e.g., "notes about the project deadline")
  - Search by concepts or topics (e.g., "discussions about sleep apnea")
  - Coding examples (e.g., "find code snippets relating to typescript types?")
  - Any query requiring understanding of meaning/context

  NOTE: 'search' and 'filterNotes' return metadata with snippets only (id, subject, lastModified, snippet)

  STEP 2 - Review and select:
  - Review the subjects, metadata, and snippets from search/filter results
  - Identify which specific emails need full content to answer the user's question
  - If snippets contain enough info, answer directly without fetching full content

  STEP 3 - Fetch full content:
  USE 'getNotes' to retrieve full note content:
  - Pass array of note IDs you need to read completely

- NEVER answer from your training data - always use tools first
- If the first query doesn't find enough information, try different approaches or tools
- Only after using tools should you formulate your answer based on the results
</rules>

<the-ask>
Here is the user's question. Follow the multi-step workflow above to efficiently find and retrieve the information.
</the-ask>
`,
        tools: getTools(messages),
        stopWhen: [stepCountIs(10)],
      });

      writer.merge(
        result.toUIMessageStream({
          sendSources: true,
          sendReasoning: true,
        })
      );

      await generateTitlePromise;
    },
    generateId: () => nanoid(),
    onFinish: async ({ responseMessage }) => {
      await appendToChatMessages(chatId, [responseMessage]);
    },
  });

  // send sources and reasoning back to the client
  return createUIMessageStreamResponse({
    stream,
  });
}
