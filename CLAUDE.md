# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Package manager**: Use `pnpm` for all package operations
- **Start dev server**: `pnpm run dev` (uses Turbopack, runs on http://localhost:3000)
- **Build**: `pnpm run build` (uses Turbopack)
- **Start production**: `pnpm start`
- **Run tests**: `vitest` (configured with `vite-tsconfig-paths` for path resolution)

## Workshop Context

This is a project workspace for the **Build a Personal Assistant in TypeScript** workshop. The goal is to implement:

- Hybrid retrieval system (BM25 + semantic embeddings + rank fusion) for 547 emails in `data/emails.json`
- Memory system with semantic recall, working memory, and episodic learning
- Agentic tools with metadata-first retrieval patterns
- Evaluation framework using tool call testing and LLM-as-judge scorers
- Human-in-the-loop approval system for destructive actions
- MCP integration for external tool access

## Architecture

This is a Next.js 15 AI chat application using the Vercel AI SDK v5 with Google Gemini as the default model.

### Key Technologies

- **Framework**: Next.js 15 (App Router with Turbopack)
- **AI SDK**: Vercel AI SDK v5 (`ai` package) with `@ai-sdk/google`, `@ai-sdk/anthropic`, and `@ai-sdk/react`
- **Models**: Google Gemini 2.5 Flash Lite (default), with support for Claude and GPT-4
- **Streaming**: Uses `streamText` API for backend streaming and `useChat` hook for frontend
- **Markdown**: `streamdown` for markdown rendering with syntax highlighting
- **UI**: Radix UI primitives + Tailwind CSS 4
- **Testing**: Vitest configured with path resolution via `vite-tsconfig-paths`
- **Evaluation**: `evalite` package for testing and evaluation
- **Utils**: `nanoid` for ID generation, `tokenlens` for token counting, `use-stick-to-bottom` for scroll management

### Directory Structure

- `src/app/api/chat/route.ts` - Chat API endpoint using `streamText`
- `src/app/api/chat/generate-title.ts` - Automatic chat title generation
- `src/app/page.tsx` - Server component that loads chats and memories
- `src/app/chat.tsx` - Client component with `useChat` hook and message rendering
- `src/components/ai-elements/` - Composable AI chat UI primitives
- `src/components/ui/` - Generic Radix UI components
- `src/lib/persistence-layer.ts` - Chat history and memory persistence to `data/db.local.json`
- `src/lib/utils.ts` - Shared utilities (`cn()` for className merging)
- `data/emails.json` - 547 emails for retrieval exercises
- `data/db.local.json` - Local JSON storage for chats and memories

### API Route Pattern

The chat endpoint (`/api/chat`) follows this pattern:

1. Validates incoming UI messages using `safeValidateUIMessages<MyMessage>`
2. Creates or retrieves chat from persistence layer
3. Uses `createUIMessageStream` to manage streaming lifecycle
4. Calls `streamText` with `google("gemini-2.5-flash-lite")` model
5. Returns `createUIMessageStreamResponse` with sources and reasoning enabled
6. Automatically generates chat titles on first message using `generateTitleForChat`
7. Persists messages via `appendToChatMessages` in `onFinish` callback

Custom message type `MyMessage` extends `UIMessage` with a `frontend-action` data type for triggering sidebar refreshes.

### Message Parts System

Messages use the Vercel AI SDK's `parts` array to support multiple content types:

- `text` - Regular text content (rendered with `Response` component using `Streamdown`)
- `reasoning` - Extended thinking content from Claude (rendered in collapsible `Reasoning` component)
- `source-url` - URLs referenced in responses (rendered in collapsible `Sources` component)

The UI iterates over `message.parts` in `src/app/chat.tsx` and renders each part type with its appropriate component.

### Persistence Layer

The `src/lib/persistence-layer.ts` file provides a file-based JSON database:

- **Storage**: All data stored in `data/db.local.json` with structure `{ chats: [], memories: [] }`
- **Chats**: Each chat has `id`, `title`, `messages`, `createdAt`, `updatedAt`
- **Memories**: Each memory has `id`, `title`, `content`, `createdAt`, `updatedAt`
- **API**: Functions like `createChat`, `getChat`, `appendToChatMessages`, `deleteChat`, `loadMemories`, `createMemory`, etc.
- **Sorting**: Both chats and memories sorted by `updatedAt` in descending order

### Component Architecture

AI elements in `src/components/ai-elements/` are composable primitives that follow Radix UI patterns:

- **Conversation**: Container with scroll management using `use-stick-to-bottom`
- **Message/MessageContent**: Individual message bubbles with role-based styling
- **PromptInput**: Complex input with attachments, drag-and-drop, paste support, model selection, and submit controls
- **Response**: Wrapper around `Streamdown` for markdown rendering with syntax highlighting (themes: `light-plus`, `dark-plus`)
- **Reasoning**: Collapsible extended thinking blocks with streaming state support
- **Sources**: Collapsible source citations
- **Actions**: Action buttons (retry, copy) shown for assistant messages
- **Loader**: Loading indicator shown during submission

### State Management

- **Chat state**: Managed by `useChat` hook from `@ai-sdk/react` with custom `MyMessage` type
- **Chat ID**: Uses URL search params (`?chatId=...`) for chat routing, falls back to generated UUID
- **Input state**: Local React state for textarea value
- **Attachments**: Context-based state in `PromptInput` component
- **Navigation**: Next.js `useRouter` and `useSearchParams` for URL-based routing
- **Sidebar refresh**: Custom `frontend-action` data messages trigger `router.refresh()`

### Styling Pattern

- Uses `cn()` utility from `@/lib/utils` for conditional classnames with `tailwind-merge` and `clsx`
- Component props accept `className` for customization
- Radix UI components styled with Tailwind CSS 4
- Uses object-based function parameters for component APIs
- Dark mode support via `next-themes` package
- Custom group selectors like `group-[.is-user]` for role-based styling

### Environment Variables

Required in `.env.local`:

- `GOOGLE_GENERATIVE_AI_API_KEY` - For Google Gemini models (required)
- `ANTHROPIC_API_KEY` - For Claude models (optional)
- `OPENAI_API_KEY` - For GPT models (optional)

### Workshop CLI Commands

The project includes custom AI Hero CLI commands:

- `pnpm run cherry-pick` - Cherry-pick from live-run-through branch
- `pnpm run reset` - Reset from live-run-through branch
