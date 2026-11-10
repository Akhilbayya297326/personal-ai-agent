"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp, Clock3, Compass, ExternalLink, Globe2, Menu, MessageSquareText,
  Plus, Search, ShieldCheck, Sparkles, Square,
} from "lucide-react";

type SearchSource = { title: string; url: string; domain: string; snippet: string; publishedAt?: string };
type ChatSummary = { id: string; title: string; createdAt: string; updatedAt: string; timeZone: string };
type MemoryEntry = { id: string; chatId: string; chatTitle: string; content: string; createdAt: string };
type MessageMetadata = { createdAt?: string; sources?: SearchSource[] };
type AppMessage = UIMessage<MessageMetadata>;

const starterPrompts = [
  { icon: Globe2, text: "What changed in React this week? Give me the sources." },
  { icon: Sparkles, text: "Compare the latest coding models for local web development." },
  { icon: Clock3, text: "When did I last ask you about a project idea?" },
  { icon: Compass, text: "Find three useful, recent articles on building reliable AI agents." },
];

function localTime(iso?: string): string {
  if (!iso) return "Just now";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Just now";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toAppMessages(messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string; sources: SearchSource[] }>): AppMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.content }],
    metadata: { createdAt: message.createdAt, sources: message.sources },
  }));
}

function textParts(message: AppMessage): string {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
}

function toolPart(part: unknown): { state?: string; output?: unknown } | null {
  if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "tool-web_search") return null;
  return part as { state?: string; output?: unknown };
}

function SearchResults({ output }: { output: unknown }) {
  if (!output || typeof output !== "object") return null;
  const result = output as { results?: SearchSource[]; error?: string };
  const sources = Array.isArray(result.results) ? result.results : [];
  if (!sources.length) {
    return result.error ? <div className="search-card"><div className="search-card-title"><Search size={12} /> Search note</div><div className="source-row"><span className="source-snippet">{result.error}</span></div></div> : null;
  }
  return (
    <div className="search-card" aria-label="Web search sources">
      <div className="search-card-title"><Search size={12} /> Searched the web · {sources.length} sources</div>
      {sources.map((source, index) => (
        <div className="source-row" key={`${source.url}-${index}`}>
          <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} <ExternalLink size={10} /></a>
          <span className="source-domain">{source.domain}{source.publishedAt ? ` · ${source.publishedAt}` : ""}</span>
          {source.snippet && <span className="source-snippet">{source.snippet}</span>}
        </div>
      ))}
    </div>
  );
}

function MessageContent({ message, streaming }: { message: AppMessage; streaming: boolean }) {
  const text = textParts(message);
  const searchParts = message.parts.map(toolPart).filter((part): part is { state?: string; output?: unknown } => Boolean(part));
  return (
    <>
      {text && <div className="message-copy"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>}
      {searchParts.map((part, index) => (
        <SearchResults key={index} output={part.state === "output-available" ? part.output : undefined} />
      ))}
      {streaming && !text && searchParts.every((part) => part.state !== "output-available") && (
        <div className="searching"><span className="spinner" /> Looking for reliable sources, then I’ll bring it together…</div>
      )}
      {message.role === "assistant" && message.metadata?.sources?.length && searchParts.length === 0 && (
        <SearchResults output={{ results: message.metadata.sources }} />
      )}
    </>
  );
}

function ChatPanel({ chat, initialMessages, timeZone, onFinished }: {
  chat: ChatSummary;
  initialMessages: AppMessage[];
  timeZone: string;
  onFinished: () => void;
}) {
  const [input, setInput] = useState("");
  const [errorText, setErrorText] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
    body: { chatId: chat.id, timeZone },
  }), [chat.id, timeZone]);
  const { messages, sendMessage, status, stop, error } = useChat({
    id: chat.id,
    messages: initialMessages,
    transport,
    onFinish: () => { setErrorText(""); onFinished(); },
    onError: (streamError) => setErrorText(streamError.message || "The assistant could not finish that answer."),
  });
  const busy = status === "submitted" || status === "streaming";
  const hasConversation = messages.some((message) => message.role === "user" || textParts(message).trim());

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  function submit(value = input) {
    const text = value.trim();
    if (!text || busy) return;
    setErrorText("");
    setInput("");
    if (textarea.current) textarea.current.style.height = "auto";
    sendMessage({ text });
  }

  return (
    <div className="chat-column">
      <div className="conversation-scroll">
        {!hasConversation ? (
          <section className="welcome" aria-label="Start a conversation">
            <div className="orbit" aria-hidden="true"><div className="orbit-core"><Sparkles size={18} /></div><span className="orbit-dot" /></div>
            <div className="eyebrow">A little more context. A lot more clarity.</div>
            <h1>Ask what’s changing.<br /><em>Or what you said.</em></h1>
            <p className="welcome-copy">Daymark looks things up when facts need checking, and keeps a private, dated record of what you ask.</p>
            <div className="suggestions">
              {starterPrompts.map(({ icon: Icon, text }) => (
                <button className="suggestion" key={text} type="button" onClick={() => submit(text)}>
                  <Icon size={14} className="suggestion-icon" /><span>{text}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="messages" aria-live="polite">
            {messages.map((message, index) => {
              const isLastAssistant = message.role === "assistant" && index === messages.length - 1;
              const userMessage = message.role === "user";
              return (
                <article className={`message-row ${userMessage ? "user" : "assistant"}`} key={message.id}>
                  {!userMessage && <div className="assistant-avatar" aria-hidden="true"><Sparkles size={14} /></div>}
                  <div className="message-body">
                    <div className="message-meta">{userMessage ? "You" : "Daymark"}<span>·</span>{localTime(message.metadata?.createdAt)}</div>
                    <MessageContent message={message} streaming={busy && isLastAssistant} />
                  </div>
                </article>
              );
            })}
            {busy && messages.at(-1)?.role === "user" && (
              <article className="message-row assistant"><div className="assistant-avatar"><Sparkles size={14} /></div><div className="message-body"><div className="message-meta">Daymark <span>·</span> working</div><div className="typing-dots"><span /><span /><span /></div></div></article>
            )}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <div className="composer-wrap">
        {(errorText || error) && <div className="error-banner" role="alert">{errorText || error?.message}</div>}
        <form className="composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <textarea
            ref={textarea}
            aria-label="Message Daymark"
            placeholder="Ask anything — or ask me to remember…"
            value={input}
            rows={1}
            maxLength={12_000}
            onChange={(event) => {
              setInput(event.target.value);
              event.currentTarget.style.height = "auto";
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
            }}
          />
          <div className="composer-actions">
            <span className="composer-hint">Return to send <span>·</span> Shift + Return for a new line</span>
            {busy ? <button className="stop-button" aria-label="Stop response" type="button" onClick={stop}><Square size={12} fill="currentColor" /></button>
              : <button className="send-button" aria-label="Send message" type="submit" disabled={!input.trim()}><ArrowUp size={16} /></button>}
          </div>
        </form>
        <div className="composer-foot">Web results can be wrong. Check linked sources for anything important.</div>
      </div>
    </div>
  );
}

export default function ChatWorkspace() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<ChatSummary | null>(null);
  const [initialMessages, setInitialMessages] = useState<AppMessage[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [timeZone, setTimeZone] = useState("UTC");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [appError, setAppError] = useState("");
  const started = useRef(false);

  const loadMemories = useCallback(async (query = "") => {
    try {
      const url = `/api/memory${query ? `?q=${encodeURIComponent(query)}` : ""}`;
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) setMemories((await response.json()).memories || []);
    } catch { /* The chat remains usable if the memory list cannot refresh. */ }
  }, []);

  const refreshChats = useCallback(async () => {
    try {
      const response = await fetch("/api/chats", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { chats: ChatSummary[] };
      setChats(data.chats || []);
      setActiveChat((current) => current ? data.chats.find((chat) => chat.id === current.id) || current : current);
      await loadMemories(memoryQuery);
    } catch { /* A stale sidebar should not interrupt an active answer. */ }
  }, [loadMemories, memoryQuery]);

  const openChat = useCallback(async (chat: ChatSummary) => {
    setSidebarOpen(false);
    setAppError("");
    try {
      const response = await fetch(`/api/chats/${chat.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("That conversation could not be opened.");
      const data = await response.json() as { chat: ChatSummary; messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string; sources: SearchSource[] }> };
      setActiveChat(data.chat);
      setInitialMessages(toAppMessages(data.messages || []));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not load conversation.");
    }
  }, []);

  const newChat = useCallback(async () => {
    setSidebarOpen(false);
    setAppError("");
    try {
      const response = await fetch("/api/chats", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeZone }),
      });
      if (!response.ok) throw new Error("Could not start a new conversation.");
      const data = await response.json() as { chat: ChatSummary };
      setChats((current) => [data.chat, ...current]);
      setActiveChat(data.chat);
      setInitialMessages([]);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Could not start a new conversation.");
    }
  }, [timeZone]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/chats", { cache: "no-store" });
        if (!response.ok) throw new Error("The local memory database could not be opened.");
        const data = await response.json() as { chats: ChatSummary[] };
        try { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"); } catch { setTimeZone("UTC"); }
        void loadMemories();
        setChats(data.chats || []);
        if (data.chats?.length) await openChat(data.chats[0]);
        else {
          const created = await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }) });
          if (!created.ok) throw new Error("Could not create a local conversation.");
          const result = await created.json() as { chat: ChatSummary };
          setActiveChat(result.chat);
          setChats([result.chat]);
        }
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Daymark could not start.");
      } finally { setLoading(false); }
    })();
  }, [loadMemories, openChat]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMemories(memoryQuery.trim()); }, 220);
    return () => window.clearTimeout(timer);
  }, [memoryQuery, loadMemories]);

  const shortZone = timeZone.split("/").at(-1)?.replaceAll("_", " ") || "Local time";

  return (
    <div className="workspace">
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`} aria-label="Conversations and memory">
        <div className="brand-row">
          <div className="brand-mark"><Compass size={20} strokeWidth={2.3} /></div>
          <div><div className="brand-name">daymark</div><div className="brand-caption">a chat that remembers</div></div>
        </div>
        <button className="new-chat" onClick={() => void newChat()}><Plus size={15} />New conversation</button>

        <div className="side-label">Conversations</div>
        <div className="conversation-list">
          {chats.length ? chats.map((chat) => (
            <button className={`conversation-item ${activeChat?.id === chat.id ? "active" : ""}`} key={chat.id} onClick={() => void openChat(chat)}>
              <MessageSquareText size={14} /><span>{chat.title || "New conversation"}</span>
            </button>
          )) : <div className="empty-memory">Your chats will appear here.</div>}
        </div>

        <div className="sidebar-divider" />
        <div className="memory-topline"><div className="side-label">Remembered asks</div><span className="memory-count">{memories.length}</span></div>
        <label className="memory-search"><Search size={13} /><input aria-label="Search past questions" placeholder="Find something you asked…" value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} /></label>
        <div className="memory-list">
          {memories.length ? memories.map((memory) => (
            <button className="memory-item" key={memory.id} onClick={() => {
              const chat = chats.find((item) => item.id === memory.chatId);
              if (chat) void openChat(chat);
            }}>
              <span className="memory-question">{memory.content}</span>
              <span className="memory-time"><Clock3 size={10} />{localTime(memory.createdAt)}</span>
            </button>
          )) : <div className="empty-memory">Your previous questions will live here, with their dates.</div>}
        </div>

        <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={13} /><span>Private by default. Conversations are stored in a local SQLite file on this machine.</span></div></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>
            <div><div className="chat-title">{activeChat?.title === "New conversation" ? "A fresh thread" : activeChat?.title || "Daymark"}</div><div className="chat-subtitle">One focused tool · grounded web search</div></div>
          </div>
          <div className="topbar-right"><span className="time-zone">{shortZone}</span><span className="tool-pill"><i />Web search only</span></div>
        </header>
        <div className="content-area">
          {appError && <div className="error-banner" role="alert">{appError}</div>}
          {loading ? <div className="chat-column"><div className="conversation-scroll"><div className="welcome"><div className="orbit"><div className="orbit-core"><Sparkles size={18} /></div></div><div className="eyebrow">Getting your memories ready</div><h1>One moment.</h1></div></div></div>
            : activeChat ? <ChatPanel key={activeChat.id} chat={activeChat} initialMessages={initialMessages} timeZone={timeZone} onFinished={() => { void refreshChats(); }} />
              : <div className="chat-column"><div className="conversation-scroll"><div className="welcome"><div className="orbit"><div className="orbit-core"><Sparkles size={18} /></div></div><div className="eyebrow">Couldn’t open a conversation</div><h1>Try a new thread.</h1><button className="new-chat" onClick={() => void newChat()}><Plus size={15} />Start a conversation</button></div></div></div>}
        </div>
      </main>
    </div>
  );
}
