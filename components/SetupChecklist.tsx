'use client';

import { useState, type ReactNode, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronDown, ChevronUp, Plus, FileUp, Map as MapIcon, PenLine, Sparkles, AlertCircle, Droplets } from 'lucide-react';
import { saveFarmMapSettings } from '@/lib/map-actions';
import { seedStarterProducts } from '@/lib/actions';

const linkStyle: CSSProperties = { color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline' };
const linkBtnStyle: CSSProperties = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'underline', fontSize: 12 };
const btnSecondary: CSSProperties = { fontSize: 13, fontWeight: 700, padding: '7px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 };
const routeBtn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13, fontWeight: 600, textDecoration: 'none' };
const errStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--red)', fontWeight: 700, marginBottom: 8 };

export function SetupChecklist({
  onboarded,
  farmName,
  unitsLabel,
  hasFields,
  fieldsTotal,
  fieldsWithSoil,
  productCount,
  sbi,
  licenceAccepted,
  defaultOpen,
}: {
  onboarded: boolean;
  farmName: string | null;
  unitsLabel: string;
  hasFields: boolean;
  fieldsTotal: number;
  fieldsWithSoil: number;
  productCount: number;
  sbi: string | null;
  licenceAccepted: boolean;
  defaultOpen?: boolean;
}) {
  const router = useRouter();

  const farmDone = onboarded;
  const sbiDone = !!sbi;
  const fieldsDone = hasFields;
  const soilDone = fieldsTotal > 0 && fieldsWithSoil >= fieldsTotal;
  const soilStarted = fieldsWithSoil > 0;
  const productsDone = productCount > 0;
  const complete = fieldsDone && soilStarted && productsDone;

  const steps = hasFields ? [farmDone, fieldsDone, soilStarted, productsDone] : [farmDone, fieldsDone];
  const doneCount = steps.filter(Boolean).length;

  const [expanded, setExpanded] = useState(defaultOpen || !complete);

  const [sbiOpen, setSbiOpen] = useState(false);
  const [sbiInput, setSbiInput] = useState(sbi ?? '');
  const [acceptor, setAcceptor] = useState('');
  const [licence, setLicence] = useState(licenceAccepted);
  const [sbiBusy, setSbiBusy] = useState(false);
  const [sbiErr, setSbiErr] = useState<string | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);

  async function saveSbi() {
    setSbiErr(null);
    if (!/^\d{9}$/.test(sbiInput.trim())) { setSbiErr('SBI must be 9 digits.'); return; }
    if (!licence) { setSbiErr('Please accept the Ordnance Survey licence to pull your boundary data.'); return; }
    setSbiBusy(true);
    const fd = new FormData();
    fd.set('sbi', sbiInput.trim());
    fd.set('licence_accepted', 'on');
    if (acceptor.trim()) fd.set('acceptor', acceptor.trim());
    const res = await saveFarmMapSettings(fd);
    setSbiBusy(false);
    if (!res.ok) { setSbiErr(res.error || 'Could not save.'); return; }
    setSbiOpen(false);
    router.refresh();
  }

  async function seed() {
    setSeedBusy(true);
    try {
      await seedStarterProducts();
      router.refresh();
    } finally {
      setSeedBusy(false);
    }
  }

  if (!expanded) {
    return (
      <div className="card" style={{ padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 22, height: 22, borderRadius: 11, background: 'var(--forest)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Check size={14} /></span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Setup complete</span>
        </div>
        <button type="button" onClick={() => setExpanded(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--forest-dark)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Review steps <ChevronDown size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>Finish setting up</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{doneCount} of {steps.length}</span>
          {complete && (
            <button type="button" onClick={() => setExpanded(false)} aria-label="Collapse" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--stone)', display: 'inline-flex' }}><ChevronUp size={16} /></button>
          )}
        </div>
      </div>

      <Item done={farmDone} title="Farm details">
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {farmName ? <>{farmName} · </> : null}{unitsLabel}. <Link href="/settings" style={linkStyle}>Edit</Link>
        </div>
      </Item>

      {!hasFields ? (
        <>
          <Item done={sbiDone} optional title="Your SBI (England)">
            {sbiDone ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                SBI {sbi} saved. <button type="button" onClick={() => setSbiOpen(true)} style={linkBtnStyle}>Change</button>
              </div>
            ) : !sbiOpen ? (
              <div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 8 }}>
                  In England? Add your Single Business Identifier and we can pull your registered field boundaries from the Rural Payments Agency — no drawing.
                </div>
                <button type="button" onClick={() => setSbiOpen(true)} style={btnSecondary}>Add SBI</button>
              </div>
            ) : (
              <div>
                <input className="input" inputMode="numeric" placeholder="9-digit SBI" value={sbiInput} onChange={(e) => setSbiInput(e.target.value)} style={{ marginBottom: 8 }} />
                <input className="input" placeholder="Your name (for the licence record)" value={acceptor} onChange={(e) => setAcceptor(e.target.value)} style={{ marginBottom: 8 }} />
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--ink)', lineHeight: 1.45, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={licence} onChange={(e) => setLicence(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>I accept the Ordnance Survey End User Licence for using my RPA land-parcel boundary data in this app.</span>
                </label>
                {sbiErr && <div style={errStyle}><AlertCircle size={13} style={{ flexShrink: 0 }} /> {sbiErr}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={saveSbi} disabled={sbiBusy} className="btn-primary" style={{ fontSize: 13, padding: '7px 14px' }}>{sbiBusy ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={() => { setSbiOpen(false); setSbiErr(null); }} style={btnSecondary}>Cancel</button>
                </div>
              </div>
            )}
          </Item>

          <Item done={false} title="Get your fields in">
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 8 }}>
              Bring your fields into Swardly — this unlocks the Plan, grazing and lime.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sbiDone && licenceAccepted && (
                <Link href="/map" style={routeBtn}><MapIcon size={15} /> Pull registered fields (recommended)</Link>
              )}
              <Link href="/fields/new" style={routeBtn}><Plus size={15} /> Add a field by hand</Link>
              <Link href="/map" style={routeBtn}><PenLine size={15} /> Draw boundaries on the map</Link>
            </div>
          </Item>
        </>
      ) : (
        <>
          <Item done title="Fields">
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {fieldsTotal} field{fieldsTotal === 1 ? '' : 's'} added. <Link href="/fields" style={linkStyle}>View</Link> · <Link href="/map" style={linkStyle}>Add more</Link>
            </div>
          </Item>

          <Item done={soilDone} title="Soil data">
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 8 }}>
              {soilStarted
                ? <>{fieldsWithSoil} of {fieldsTotal} field{fieldsTotal === 1 ? '' : 's'} have pH/P/K/Mg.</>
                : <>No soil data yet. Importing a report is quickest — it fills pH/P/K/Mg and soil type across many fields at once.</>}
            </div>
            <Link href="/import" style={routeBtn}><FileUp size={15} /> Import a soil report</Link>
          </Item>

          <Item done={productsDone} title="Your products">
            {productsDone ? (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                {productCount} product{productCount === 1 ? '' : 's'} set up. <Link href="/products" style={linkStyle}>Manage</Link>
              </div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 8 }}>
                  Add the fertilisers and slurry you use so the Plan can size what to spread. The common UK set is a starting point — bag-fert analyses are standard, and the slurry and FYM use RB209 default values you can replace with your own.
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={seed} disabled={seedBusy} className="btn-primary" style={{ fontSize: 13, padding: '7px 14px' }}>{seedBusy ? 'Adding…' : 'Add common products'}</button>
                  <Link href="/products" style={btnSecondary}>Add my own</Link>
                </div>
              </div>
            )}
            <Link href="/products/new?type=slurry&return=/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'none' }}>
              <Droplets size={13} /> Got a slurry analysis? Enter your own values
            </Link>
          </Item>
        </>
      )}

      <Link href="/assistant" style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, fontSize: 12, color: 'var(--forest-dark)', fontWeight: 700, textDecoration: 'none' }}>
        <Sparkles size={14} /> Stuck? Ask Swardly
      </Link>
    </div>
  );
}

function Item({ done, optional, title, children }: { done?: boolean; optional?: boolean; title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
      <span
        style={{
          width: 22, height: 22, borderRadius: 11, flexShrink: 0, marginTop: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: done ? 'var(--forest)' : 'transparent',
          border: done ? 'none' : '2px solid var(--line)',
          color: done ? 'var(--paper)' : 'transparent',
        }}
      >
        {done ? <Check size={13} /> : null}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 3 }}>
          {title}
          {optional && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginLeft: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Optional</span>}
        </div>
        {children}
      </div>
    </div>
  );
}
