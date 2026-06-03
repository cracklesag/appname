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

export const dynamic = 'force-dynamic';
// The tool loop can take a few seconds; give Vercel headroom.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await getFarmContext();
  if (!ctx) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array.' }, { status: 400 });
  }

  const settings = await loadSettings();
  const framing = {
    farmName: settings.farmName ?? null,
    role: ctx.role,
    unitSystem: settings.unitSystem,
    todayIso: new Date().toISOString().slice(0, 10),
  };

  try {
    const { reply, toolsUsed } = await runAssistant(messages as PlainMessage[], framing);
    return NextResponse.json({ reply, toolsUsed });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Assistant error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
