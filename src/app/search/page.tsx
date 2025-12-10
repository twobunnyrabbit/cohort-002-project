import { TopBar } from "@/components/top-bar";
import { SearchInput } from "./search-input";
import { NoteList } from "./email-list";
import { SearchPagination } from "./search-pagination";
import { PerPageSelector } from "./per-page-selector";
import fs from "fs/promises";
import path from "path";
import { loadChats, loadMemories } from "@/lib/persistence-layer";
import { CHAT_LIMIT } from "../page";
import { SideBar } from "@/components/side-bar";

// interface Email {
//   id: string;
//   threadId: string;
//   from: string;
//   to: string | string[];
//   cc?: string[];
//   subject: string;
//   body: string;
//   timestamp: string;
//   inReplyTo?: string;
//   references?: string[];
//   labels?: string[];
//   arcId?: string;
//   phaseId?: number;
// }

interface Note {
  id: string;
  subject: string;
  content: string;
  lastModified: string;
}

async function loadNotes(): Promise<Note[]> {
  const filePath = path.join(process.cwd(), "data", "obsidian-notes.json");
  const fileContent = await fs.readFile(filePath, "utf-8");
  return JSON.parse(fileContent);
}

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string; page?: string; perPage?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams.q || "";
  const page = Number(searchParams.page) || 1;
  const perPage = Number(searchParams.perPage) || 10;

  const allNotes = await loadNotes();

  // Transform emails to match the expected format
  const transformedNotes = allNotes
    .map((note) => ({
      id: note.id,
      subject: note.subject,
      content: note.content,
      lastModified: note.lastModified,
    }))
    .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // Filter emails based on search query
  const filteredNotes = query
    ? transformedNotes.filter(
        (note) =>
          note.subject.toLowerCase().includes(query.toLowerCase()) ||
          note.content.toLowerCase().includes(query.toLowerCase())
      )
    : transformedNotes;

  const totalPages = Math.ceil(filteredNotes.length / perPage);
  const startIndex = (page - 1) * perPage;
  const paginatedNotes = filteredNotes.slice(
    startIndex,
    startIndex + perPage
  );
  const allChats = await loadChats();
  const chats = allChats.slice(0, CHAT_LIMIT);
  const memories = await loadMemories();

  return (
    <>
      <SideBar chats={chats} memories={memories} chatIdFromSearchParams={""} />
      <div className="h-screen flex flex-col w-full">
        <TopBar showSidebar={true} title="Data" />
        <div className="flex-1">
          <div className="max-w-4xl mx-auto xl:px-2 px-6 py-6">
            <div className="mb-6">
              <p className="text-sm text-muted-foreground">
                Search through your email archive
              </p>
            </div>

            <div className="flex md:items-center md:justify-between gap-4 flex-col md:flex-row">
              <SearchInput initialQuery={query} currentPerPage={perPage} />
              <PerPageSelector currentPerPage={perPage} query={query} />
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">
                  {query ? (
                    <>
                      Found {filteredNotes.length} result
                      {filteredNotes.length !== 1 ? "s" : ""} for &ldquo;
                      {query}
                      &rdquo;
                    </>
                  ) : (
                    <>Found {filteredNotes.length} emails</>
                  )}
                </p>
              </div>
              <NoteList notes={paginatedNotes} />
              {totalPages > 1 && (
                <div className="mt-6">
                  <SearchPagination
                    currentPage={page}
                    totalPages={totalPages}
                    query={query}
                    perPage={perPage}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
