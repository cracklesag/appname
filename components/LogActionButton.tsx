'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Scissors, Sprout, Droplet, Mountain, Layers, X } from 'lucide-react';

/**
 * Log action — a prominent home-screen button that opens a bottom sheet
 * letting the user quickly record any action (cut or application) without
 * navigating into a field first. Each option routes to the relevant entry
 * flow where the field(s) and date are chosen.
 *
 * Cut → the batch cut flow (handles one or many fields, back-dating).
 * Fertiliser / Slurry / Solid manure / Lime → the log application flow with
 * the product type pre-selected. The application form lets the user pick the
 * field. (Batch applications are a later enhancement; for now this is a fast
 * route into the existing single-field entry, pre-filtered by type.)
 */

type ActionOption = {
  key: string;
  label: string;
  sub: string;
  icon: typeof Scissors;
  tone: string;
  toneBg: string;
  href: string;
};

const OPTIONS: ActionOption[] = [
  {
    key: 'cut',
    label: 'Cut',
    sub: 'Silage, bales or grazing · one or many fields',
    icon: Scissors,
    tone: '#2B4129',
    toneBg: '#E1E6D9',
    href: '/cuts/batch',
  },
  {
    key: 'fert',
    label: 'Fertiliser',
    sub: 'Granular or liquid bag fert',
    icon: Sprout,
    tone: '#2B4129',
    toneBg: '#E1E6D9',
    href: '/log?type=bag_fert',
  },
  {
    key: 'slurry',
    label: 'Slurry',
    sub: 'Cattle, pig or digestate',
    icon: Droplet,
    tone: '#2C4A57',
    toneBg: '#DBE4E8',
    href: '/log?type=slurry',
  },
  {
    key: 'solid_manure',
    label: 'Solid manure',
    sub: 'FYM, poultry, compost',
    icon: Mountain,
    tone: '#6B4A12',
    toneBg: '#F2E5C9',
    href: '/log?type=solid_manure',
  },
  {
    key: 'lime',
    label: 'Lime',
    sub: 'Ground, granular or mag lime',
    icon: Layers,
    tone: '#4A4239',
    toneBg: '#E5DFD5',
    href: '/log?type=lime',
  },
];

export function LogActionButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          background: 'var(--forest)',
          color: 'var(--paper)',
          border: 'none',
          borderRadius: 10,
          padding: '15px',
          fontSize: 15,
          fontWeight: 700,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <Plus size={20} /> Log action
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Log an action"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(20,20,18,0.5)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--card)',
              borderRadius: '18px 18px 0 0',
              padding: '14px 16px calc(22px + env(safe-area-inset-bottom))',
              maxWidth: 480,
              margin: '0 auto',
              width: '100%',
              animation: 'swardly-sheet-up 220ms ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Log an action</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            {OPTIONS.map((o) => {
              const Icon = o.icon;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => go(o.href)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 13,
                    padding: '12px',
                    marginBottom: 8,
                    background: 'var(--paper-deep)',
                    border: 'none',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 9,
                      background: o.toneBg,
                      color: o.tone,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={19} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{o.label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{o.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <style>{`
            @keyframes swardly-sheet-up {
              from { transform: translateY(100%); }
              to   { transform: translateY(0); }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
