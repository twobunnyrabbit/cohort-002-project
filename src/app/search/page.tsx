import { SideBar } from "@/components/side-bar";
import { TopBar } from "@/components/top-bar";
import { SearchInput } from "./search-input";
import { NoteList } from "./note-list";
import { SearchPagination } from "./search-pagination";
import { PerPageSelector } from "./per-page-selector";
import { loadChats, loadMemories } from "@/lib/persistence-layer";
import { CHAT_LIMIT } from "../page";
import {
  loadNotes,
  loadOrGenerateEmbeddings,
  searchWithEmbeddings,
  searchWithRRF,
} from "../search";

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string; page?: string; perPage?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams.q || "";
  const page = Number(searchParams.page) || 1;
  const perPage = Number(searchParams.perPage) || 10;

  const allNotes = await loadNotes();

  // const embeddings = await loadOrGenerateEmbeddings(allNotes);

  // console.log('Notes embeddings loaded:', embeddings.length);

  const notesWithScores = await searchWithRRF(query, allNotes);

  // Transform notes to match the expected format
  const transformedNotes = notesWithScores
    .map(({ note, score }) => ({
      id: note.id,
      subject: note.subject,
      preview: note.chunk.substring(0, 100) + "...",
      content: note.chunk,
      lastModified: note.lastModified,
      chunkIndex: note.index,
      totalChunks: note.totalChunks,
      score: score,
    }))
    .sort((a, b) => b.score - a.score);

  // .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // Filter notes based on search query
  const filteredNotes = query
    ? transformedNotes.filter((note) => note.score > 0)
    : transformedNotes;

  if (query) {
    console.log("there's a query");
    console.log(`filteredNotes length: ${filteredNotes.length}`);
  } else {
    console.log("no query");
  }

  const totalPages = Math.ceil(filteredNotes.length / perPage);

  const startIndex = (page - 1) * perPage;

  const paginatedNotes = filteredNotes.slice(startIndex, startIndex + perPage);
  // console.dir(paginatedNotes);

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
                Search through your note archive
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
                    <>Found {filteredNotes.length} notes</>
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
