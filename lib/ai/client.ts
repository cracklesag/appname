// Tiny client-side helper that defines the contract between the chat UI and the
// /api/assistant route. The UI keeps an array of these messages in React state
// and calls askAssistant() each time the user sends one. No streaming: the
// promise resolves with the full reply.

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  reply: string;
  toolsUsed: string[];
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
export async function askAssistant(messages: AssistantMessage[]): Promise<AssistantReply> {
  const res = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Assistant error (${res.status})`);
  }
  return (await res.json()) as AssistantReply;
}
