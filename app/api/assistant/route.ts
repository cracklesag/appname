// POST /api/assistant
// Body:    { messages: { role: 'user' | 'assistant', content: string }[] }
// Returns: { reply: string, toolsUsed: string[] }   (200)
//          { error: string }                          (401 / 400 / 500)
//
// The client holds the conversation as plain {role, content} text messages and
// posts the whole list each turn (the server is stateless). The tool-use loop
// runs server-side; the client never sees tool calls.

import { NextRequest, NextResponse } from 'next/server';
import { runAssistant, type PlainMessage } from '@/lib/ai/chat';
import { loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// The tool loop can take a few seconds; give Vercel headroom.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext();
  if (!ctx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: { messages?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array.' }, { status: 400 });
  }

  // For the Q&A log: the question is the latest user message; cap stored
  // sizes so a pasted essay can't bloat the table.
  const lastUser = [...(messages as PlainMessage[])].reverse().find((m) => m?.role === 'user');
  const question = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 4000) : '';
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 64) : null;
  const turn = (messages as PlainMessage[]).filter((m) => m?.role === 'user').length;
  const startedAt = Date.now();

  const settings = await loadSettings();
  const framing = {
    farmName: settings.farmName ?? null,
    role: ctx.role,
    accountType: (settings.accountType ?? 'farm') as 'farm' | 'contractor',
    unitSystem: settings.unitSystem,
    todayIso: new Date().toISOString().slice(0, 10),
  };

  // Fire-and-forget log writer — a logging failure must never break a reply.
  const writeLog = async (fields: { answer?: string | null; model?: string | null; tools?: string[]; error?: string | null }) => {
    if (!question) return;
    try {
      const supabase = createClient();
      await supabase.from('assistant_logs').insert({
        user_id: ctx.userId,
        owner_id: ctx.ownerId,
        account_type: settings.accountType ?? 'farm',
        conversation_id: conversationId,
        turn,
        question,
        answer: fields.answer ? fields.answer.slice(0, 8000) : null,
        model: fields.model ?? null,
        tools_used: fields.tools ?? [],
        duration_ms: Date.now() - startedAt,
        error: fields.error ?? null,
      });
    } catch (logErr) {
      console.error('[assistant] log write failed:', logErr instanceof Error ? logErr.message : logErr);
    }
  };

  try {
    const { reply, toolsUsed, model } = await runAssistant(messages as PlainMessage[], framing);
    console.log(`[assistant] env ASSISTANT_MODEL=${process.env.ASSISTANT_MODEL ?? '(unset)'} served=${model}`);
    await writeLog({ answer: reply, model, tools: toolsUsed });
    return NextResponse.json({ reply, toolsUsed, model });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Assistant error.';
    await writeLog({ error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
