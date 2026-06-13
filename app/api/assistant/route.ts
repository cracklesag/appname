// POST /api/assistant
// Body:    { messages: { role: 'user' | 'assistant', content: string }[] }
// Returns: { reply: string, toolsUsed: string[] }   (200)
//          { error: string }                          (401 / 400 / 429 / 500)
//
// The client holds the conversation as plain {role, content} text messages and
// posts the whole list each turn (the server is stateless). The tool-use loop
// runs server-side; the client never sees tool calls.
//
// Cost controls (this route spends real money per call):
//   * Per-user rate limit, counted against assistant_logs (durable across
//     serverless instances — no Redis needed). Default 25/hour, overridable
//     via ASSISTANT_RATE_LIMIT_PER_HOUR.
//   * History trimmed server-side to the last MAX_HISTORY_MESSAGES messages
//     and MAX_MESSAGE_CHARS per message, whatever the client sends. The
//     client trims too (lib/ai/client.ts) but the server doesn't trust it.
//   * Upstream errors are logged in full (and stored in assistant_logs for
//     the Q&A review) but the client only ever sees a generic message —
//     raw Anthropic API errors leak model/config details.

import { NextRequest, NextResponse } from 'next/server';
import { runAssistant, type PlainMessage } from '@/lib/ai/chat';
import { loadSettings } from '@/lib/data';
import { getFarmContext } from '@/lib/farm';
import { ukTodayIso } from '@/lib/rules';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
// The tool loop can take a few seconds; give Vercel headroom.
export const maxDuration = 60;

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 8000;
const DEFAULT_RATE_LIMIT_PER_HOUR = 25;

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext();
  if (!ctx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: { messages?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array.' }, { status: 400 });
  }

  const supabase = createClient();

  // Per-user rate limit. assistant_logs writes are best-effort, so this can
  // undercount slightly — acceptable; it exists to stop runaway spend, not to
  // meter to the penny.
  const limitPerHour = Math.max(
    1,
    parseInt(process.env.ASSISTANT_RATE_LIMIT_PER_HOUR ?? '', 10) || DEFAULT_RATE_LIMIT_PER_HOUR,
  );
  try {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase
      .from('assistant_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .gte('created_at', hourAgo);
    if ((count ?? 0) >= limitPerHour) {
      return NextResponse.json(
        { error: "You've asked a lot in the last hour — give it a few minutes and try again." },
        { status: 429 },
      );
    }
  } catch {
    // Rate-limit check failing must never block a legitimate question.
  }

  // Trim + sanitise the history regardless of what the client sent: keep the
  // most recent messages, cap each message's length. Token cost otherwise
  // grows quadratically over a long conversation.
  const messages: PlainMessage[] = (rawMessages as PlainMessage[])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array.' }, { status: 400 });
  }

  // For the Q&A log: the question is the latest user message; cap stored
  // sizes so a pasted essay can't bloat the table.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 4000) : '';
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.slice(0, 64) : null;
  const turn = messages.filter((m) => m.role === 'user').length;
  const startedAt = Date.now();

  const settings = await loadSettings();
  const framing = {
    farmName: settings.farmName ?? null,
    role: ctx.role,
    accountType: (ctx.accountType ?? 'farm') as 'farm' | 'contractor' | 'agronomist',
    unitSystem: settings.unitSystem,
    todayIso: ukTodayIso(),
  };

  // Fire-and-forget log writer — a logging failure must never break a reply.
  const writeLog = async (fields: { answer?: string | null; model?: string | null; tools?: string[]; error?: string | null }) => {
    if (!question) return;
    try {
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
    const { reply, toolsUsed, model, suggestions } = await runAssistant(messages, framing);
    await writeLog({ answer: reply, model, tools: toolsUsed });
    return NextResponse.json({ reply, toolsUsed, model, suggestions });
  } catch (e) {
    // Full detail server-side + in the Q&A log; generic message to the client.
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[assistant] error:', detail);
    await writeLog({ error: detail });
    return NextResponse.json(
      { error: 'The assistant hit a problem answering that. Try again in a moment.' },
      { status: 500 },
    );
  }
}
