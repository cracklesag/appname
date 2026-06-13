// Tiny client-side helper that defines the contract between the chat UI and the
// /api/assistant route. The UI keeps an array of these messages in React state
// and calls askAssistant() each time the user sends one. No streaming: the
// promise resolves with the full reply.

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Set on assistant messages by the UI: which model served it + tools used. */
  model?: string;
  tools?: string[];
  /** Up to 3 tappable follow-up suggestions the model offered for this answer. */
  suggestions?: string[];
}

export interface AssistantReply {
  reply: string;
  toolsUsed: string[];
  model?: string;
  suggestions?: string[];
}

/**
 * Send the conversation so far (including the new user message as the last
 * entry) and get the assistant's reply. Throws on error so the UI can show a
 * friendly failure state.
 *
 * Example:
 *   const next = [...messages, { role: 'user', content: text }];
 *   setMessages(next);
 *   const { reply } = await askAssistant(next);
 *   setMessages([...next, { role: 'assistant', content: reply }]);
 */
// Mirrors the server-side caps in /api/assistant — the server trims anyway,
// but trimming here too keeps long conversations from shipping ever-growing
// request bodies over a weak farm signal.
const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 8000;

export async function askAssistant(messages: AssistantMessage[], conversationId?: string): Promise<AssistantReply> {
  const trimmed = messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  const res = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: trimmed, conversationId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Assistant error (${res.status})`);
  }
  return (await res.json()) as AssistantReply;
}
