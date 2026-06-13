'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Mic, RefreshCw } from 'lucide-react';
import { askAssistant, type AssistantMessage } from '@/lib/ai/client';

// Suggested openers shown on the empty state. Chosen to map onto what the
// assistant can actually do (soil ranking, recent activity, app knowledge), so
// the first tap teaches what it's for without disappointing.
const SUGGESTIONS = [
  'Which fields are lowest on P?',
  'What have I spread recently?',
  'Show me my lowest-pH fields',
  'How does the fertiliser plan work?',
];

const COMPOSER_CLEARANCE = 96; // px of bottom padding so the fixed composer never covers the last reply

// ---- minimal markdown -> React (the model returns plain text / light markdown).
// Handles paragraphs, bullet & numbered lists, headings, **bold** and `code`.
// No raw HTML is ever injected — everything is built as React nodes.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Split on **bold** and `code`, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) {
      out.push(<strong key={`${keyBase}-b${i}`}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      out.push(
        <code
          key={`${keyBase}-c${i}`}
          style={{ background: 'var(--paper-deep)', borderRadius: 4, padding: '1px 5px', fontSize: '0.92em' }}
        >
          {part.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(part);
    }
  });
  return out;
}

function renderMarkdown(md: string): React.ReactNode {
  // Ensure pipe-table runs sit in their own block, even when the model glues a
  // heading line directly above them (single newline). Without this they'd
  // fall into the paragraph branch and show as raw pipes.
  const rawLines = md.trim().split('\n');
  const padded: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i].trim().startsWith('|');
    const prev = i > 0 && rawLines[i - 1].trim().startsWith('|');
    if (cur && !prev && padded.length > 0 && padded[padded.length - 1].trim() !== '') padded.push('');
    if (!cur && prev && rawLines[i].trim() !== '') padded.push('');
    padded.push(rawLines[i]);
  }
  const blocks = padded.join('\n').split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;

    // Pipe table -> real table (safety net; the model is told not to emit these).
    const isTable = lines.length >= 2 && lines.every((l) => l.trim().startsWith('|'));
    if (isTable) {
      const parseRow = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const isSep = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '');
      const rows = lines.map(parseRow).filter((cells) => !isSep(cells));
      if (rows.length > 0) {
        const [head, ...body] = rows;
        const cellStyle: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid var(--line)', textAlign: 'left', fontSize: 13, verticalAlign: 'top' };
        return (
          <div key={`t${bi}`} style={{ overflowX: 'auto', margin: '0 0 10px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>{head.map((c, ci) => <th key={`t${bi}h${ci}`} style={{ ...cellStyle, fontWeight: 700, borderBottom: '2px solid var(--line)' }}>{renderInline(c, `t${bi}h${ci}`)}</th>)}</tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={`t${bi}r${ri}`}>{r.map((c, ci) => <td key={`t${bi}r${ri}c${ci}`} style={cellStyle}>{renderInline(c, `t${bi}r${ri}c${ci}`)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }

    const isBullet = lines.every((l) => /^\s*[-*]\s+/.test(l));
    if (isBullet) {
      return (
        <ul key={`ul${bi}`} style={{ margin: '0 0 8px', paddingLeft: 20 }}>
          {lines.map((l, li) => (
            <li key={`ul${bi}-${li}`} style={{ marginBottom: 3 }}>
              {renderInline(l.replace(/^\s*[-*]\s+/, ''), `ul${bi}-${li}`)}
            </li>
          ))}
        </ul>
      );
    }

    const isNumbered = lines.every((l) => /^\s*\d+\.\s+/.test(l));
    if (isNumbered) {
      return (
        <ol key={`ol${bi}`} style={{ margin: '0 0 8px', paddingLeft: 22 }}>
          {lines.map((l, li) => (
            <li key={`ol${bi}-${li}`} style={{ marginBottom: 3 }}>
              {renderInline(l.replace(/^\s*\d+\.\s+/, ''), `ol${bi}-${li}`)}
            </li>
          ))}
        </ol>
      );
    }

    if (/^#{1,3}\s+/.test(lines[0])) {
      return (
        <div key={`h${bi}`} style={{ fontWeight: 700, margin: '0 0 6px' }}>
          {renderInline(lines[0].replace(/^#{1,3}\s+/, ''), `h${bi}`)}
        </div>
      );
    }

    return (
      <p key={`p${bi}`} style={{ margin: '0 0 8px', lineHeight: 1.5 }}>
        {lines.map((l, li) => (
          <span key={`p${bi}-${li}`}>
            {renderInline(l, `p${bi}-${li}`)}
            {li < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
  });
}

// ---- Web Speech API (optional, on-device, no token cost). Loosely typed
// because it isn't in the standard DOM lib; we feature-detect at runtime.
interface SpeechResultAlt { transcript: string }
interface SpeechResult { 0: SpeechResultAlt; isFinal: boolean }
interface SpeechResultList { length: number; [i: number]: SpeechResult }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function AssistantChat() {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Detect speech support once on mount.
  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    setVoiceSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      try { recRef.current?.stop(); } catch { /* ignore */ }
    };
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const grow = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  // Resize to fit the content whenever the text changes. Driven by `input` so it
  // covers typing, dictation (Web Speech sets the value programmatically) and the
  // reset to one line after sending alike — and it runs after the new value is in
  // the DOM, so scrollHeight is measured correctly. (Dictation previously resized
  // on the same frame it set the text, measuring the still-empty box, which is why
  // it stayed one line tall.)
  useEffect(() => { grow(); }, [input, grow]);

  const convoRef = useRef<string | null>(null);
  const convoId = () => {
    if (!convoRef.current) {
      convoRef.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return convoRef.current;
  };

  const runTurn = useCallback(async (history: AssistantMessage[]) => {
    setLoading(true);
    setError(null);
    try {
      const { reply, toolsUsed, model, suggestions } = await askAssistant(history, convoId());
      setMessages([...history, { role: 'assistant', content: reply, model, tools: toolsUsed, suggestions }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history: AssistantMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(history);
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    void runTurn(history);
  }, [messages, loading, runTurn]);

  const retry = useCallback(() => {
    if (loading || messages.length === 0) return;
    if (messages[messages.length - 1].role !== 'user') return;
    void runTurn(messages);
  }, [loading, messages, runTurn]);

  const toggleVoice = useCallback(() => {
    if (listening) {
      try { recRef.current?.stop(); } catch { /* ignore */ }
      setListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-GB';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      let finalText = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
      }
      if (finalText) {
        setInput((prev) => (prev ? `${prev} ${finalText.trim()}` : finalText.trim()));
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  const empty = messages.length === 0;

  return (
    <div style={{ paddingBottom: COMPOSER_CLEARANCE }}>
      {empty ? (
        <div style={{ padding: '22px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--forest)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={18} />
            </div>
            <div style={{ fontFamily: '"Fraunces", serif', fontSize: 19, fontWeight: 600, color: 'var(--forest-dark)' }}>
              {'Ask Swardly'}
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 16px' }}>
            {'Ask about your fields, soil indices, recent cuts and applications, or how anything in the app works. It reads your farm\u2019s own data to answer.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                style={{
                  textAlign: 'left',
                  background: 'var(--card)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '11px 13px',
                  fontSize: 14,
                  color: 'var(--ink)',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Sparkles size={14} style={{ color: 'var(--forest)', flexShrink: 0 }} />
                <span>{s}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ padding: '14px 14px 4px' }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  maxWidth: '86%',
                  background: m.role === 'user' ? 'var(--forest)' : 'var(--card)',
                  color: m.role === 'user' ? 'var(--paper)' : 'var(--ink)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--line)',
                  borderRadius: 14,
                  borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                  borderBottomLeftRadius: m.role === 'user' ? 14 : 4,
                  padding: '10px 13px',
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: m.role === 'user' ? 'pre-wrap' : 'normal',
                  overflowWrap: 'anywhere',
                }}
              >
                {m.role === 'user' ? m.content : <div className="assistant-md">{renderMarkdown(m.content)}</div>}
                {m.role === 'assistant' && (m.model || (m.tools && m.tools.length > 0)) && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, opacity: 0.85 }}>
                    {m.model}{m.tools && m.tools.length > 0 ? ` · ${m.tools.join(', ')}` : ''}
                  </div>
                )}
              </div>
              {m.role === 'assistant' && i === messages.length - 1 && !loading && m.suggestions && m.suggestions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, maxWidth: '86%' }}>
                  {m.suggestions.map((s, si) => (
                    <button
                      key={si}
                      type="button"
                      onClick={() => send(s)}
                      style={{
                        background: 'var(--forest-soft)',
                        color: 'var(--forest-dark)',
                        border: '1px solid var(--line)',
                        borderRadius: 14,
                        padding: '6px 11px',
                        fontSize: 12.5,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        lineHeight: 1.3,
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
              <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, borderBottomLeftRadius: 4, padding: '12px 15px', display: 'inline-flex', gap: 5 }}>
                <span className="sw-dot" />
                <span className="sw-dot" style={{ animationDelay: '0.15s' }} />
                <span className="sw-dot" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
              <div style={{ maxWidth: '90%', background: 'var(--red-soft)', border: '1px solid var(--red)', borderRadius: 12, padding: '10px 13px', fontSize: 13, color: 'var(--red)' }}>
                <div style={{ marginBottom: 8 }}>{error}</div>
                <button
                  type="button"
                  onClick={retry}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--red)', color: 'var(--paper)', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  <RefreshCw size={13} /> {'Try again'}
                </button>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Composer — pinned to the bottom of the 480px shell, like the bottom nav. */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: 480,
          margin: '0 auto',
          background: 'var(--card)',
          borderTop: '1px solid var(--line)',
          padding: '10px 12px calc(10px + env(safe-area-inset-bottom))',
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={listening ? 'Stop dictation' : 'Dictate your question'}
              aria-pressed={listening}
              style={{
                flexShrink: 0,
                width: 44,
                height: 44,
                borderRadius: 12,
                border: '1px solid var(--line)',
                background: listening ? 'var(--forest)' : 'var(--paper)',
                color: listening ? 'var(--paper)' : 'var(--ink-soft)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Mic size={19} />
            </button>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); grow(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={listening ? 'Listening\u2026' : 'Ask about your farm\u2026'}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              width: '100%',
              background: 'var(--paper)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              padding: '11px 13px',
              fontSize: 16, // 16px keeps iOS from zooming the page on focus
              lineHeight: 1.4,
              color: 'var(--ink)',
              fontFamily: 'inherit',
              maxHeight: 140,
              overflowY: 'auto',
            }}
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            aria-label="Send"
            style={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: 12,
              border: 'none',
              background: !input.trim() || loading ? 'var(--stone-soft)' : 'var(--forest)',
              color: !input.trim() || loading ? 'var(--stone)' : 'var(--paper)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: !input.trim() || loading ? 'default' : 'pointer',
            }}
          >
            <Send size={19} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes sw-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
        .sw-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--forest); display: inline-block; animation: sw-blink 1.2s infinite ease-in-out; }
        .assistant-md > :last-child { margin-bottom: 0 !important; }
      `}</style>
    </div>
  );
}
