"use client";

import { useState } from "react";
import {
  Send,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Sparkles,
  Bot,
  User,
  Zap,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelUsed?: string;
  latencyMs?: number;
}

export function FreeLlmChatPlayground() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedRouterMode, setSelectedRouterMode] = useState("auto");
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("You are an expert AI assistant running on Fleet AI Router.");

  const handleSend = () => {
    if (!inputPrompt.trim() || isSending) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputPrompt.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt("");
    setIsSending(true);

    setTimeout(() => {
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Response routed seamlessly through Fleet AI smart fallback chain (served by Cerebras Fast Llama 3.1 8B in 142ms). Zero cost incurred from 6.4B monthly token allowance.`,
        modelUsed: "Cerebras / llama3.1-8b",
        latencyMs: 142,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsSending(false);
    }, 600);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Playground</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Send a chat completion through the router and see which provider serves it.
          </p>
        </div>

        {/* Fallback chain dropdown */}
        <div className="relative">
          <select
            value={selectedRouterMode}
            onChange={(e) => setSelectedRouterMode(e.target.value)}
            className="appearance-none bg-[#121215] border border-zinc-800 text-xs text-zinc-200 rounded-lg px-3 py-1.5 pr-8 focus:outline-none focus:border-zinc-700 cursor-pointer"
          >
            <option value="auto">Auto (fallback chain)</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="codestral">Codestral</option>
            <option value="llama-3.3-70b">Llama 3.3 70B (CF)</option>
            <option value="cerebras-fast">Cerebras 8B Fast</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
        </div>
      </div>

      {/* Main Playground Box */}
      <div className="obsidian-card p-6 flex flex-col justify-between min-h-[500px] relative overflow-hidden">
        {/* Messages or Empty State */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-72 text-center text-zinc-400">
              <h3 className="text-sm font-semibold text-white mb-1">Send a message to get started.</h3>
              <p className="text-xs text-zinc-500 max-w-sm">
                Using Auto (fallback chain). Switch models in the selector above.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 text-xs leading-relaxed ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="h-7 w-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-white">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                )}

                <div
                  className={`p-3.5 rounded-xl max-w-xl ${
                    msg.role === "user"
                      ? "bg-white text-black font-medium"
                      : "bg-[#141418] border border-zinc-800 text-zinc-200"
                  }`}
                >
                  <p>{msg.content}</p>
                  {msg.modelUsed && (
                    <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[10px] font-mono text-zinc-400">
                      <span>{msg.modelUsed}</span>
                      <span className="text-emerald-400">{msg.latencyMs}ms</span>
                    </div>
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="h-7 w-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-zinc-400">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Bottom controls & input */}
        <div className="pt-4 border-t border-zinc-800/80 space-y-3">
          {/* System prompt toggle */}
          <div>
            <button
              onClick={() => setSystemPromptOpen(!systemPromptOpen)}
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white cursor-pointer transition-colors"
            >
              {systemPromptOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <span>System prompt</span>
            </button>
            {systemPromptOpen && (
              <div className="mt-2">
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={2}
                  className="w-full bg-[#0c0c0e] border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
                />
              </div>
            )}
          </div>

          {/* Input field */}
          <div className="flex items-center gap-2 bg-[#0c0c0e] border border-zinc-800 rounded-xl px-3 py-1.5 focus-within:border-zinc-600 transition-colors">
            <button className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (↩ to send, ⇧↩ for newline)"
              className="flex-1 bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none py-1.5"
            />
            <button
              onClick={handleSend}
              disabled={!inputPrompt.trim() || isSending}
              className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-xs font-medium text-white transition-colors cursor-pointer"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
