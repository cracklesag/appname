import { Agreement } from '@/lib/types';

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', fontSize: 14, border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontFamily: 'inherit', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 };
const sectionLbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', margin: '18px 0 8px' };

function Num({ name, def, ph, suffix }: { name: string; def: number | null | undefined; ph?: string; suffix?: string }) {
  return (
    <div style={{ flex: 1 }}>
      <label style={lbl}>{ph}{suffix ? ` (${suffix})` : ''}</label>
      <input name={name} type="number" inputMode="decimal" step="any" defaultValue={def ?? ''} placeholder="—" style={inp} />
    </div>
  );
}
function Md({ name, def, label }: { name: string; def: string | null | undefined; label: string }) {
  return (
    <div style={{ flex: 1 }}>
      <label style={lbl}>{label}</label>
      <input name={name} defaultValue={def ?? ''} placeholder="MM-DD" style={inp} />
    </div>
  );
}
function Check({ name, def, label }: { name: string; def: boolean | undefined; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0' }}>
      <input type="checkbox" name={name} defaultChecked={def} style={{ width: 17, height: 17, flexShrink: 0 }} /> {label}
    </label>
  );
}

/**
 * The full restriction form for an agreement. Native <form> posting to a server
 * action; `a` provides defaults (null for the add form). Every restriction is
 * optional — set only what applies. Advisory throughout.
 */
export function AgreementForm({
  action, a, submitLabel,
}: {
  action: (fd: FormData) => void | Promise<void>;
  a: Agreement | null;
  submitLabel: string;
}) {
  return (
    <form action={action} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: 14 }}>
      {a && <input type="hidden" name="id" value={a.id} />}

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ width: 110 }}>
          <label style={lbl}>Code</label>
          <input name="code" defaultValue={a?.code ?? ''} placeholder="e.g. GS6" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Name</label>
          <input name="name" defaultValue={a?.name ?? ''} required placeholder="Agreement name" style={inp} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <div style={{ width: 130 }}>
          <label style={lbl}>Scheme</label>
          <select name="scheme" defaultValue={a?.scheme ?? 'custom'} style={inp}>
            <option value="sfi">SFI</option>
            <option value="cs">Countryside Stewardship</option>
            <option value="es">Environmental Stewardship</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Summary</label>
          <input name="summary" defaultValue={a?.summary ?? ''} placeholder="one-line description" style={inp} />
        </div>
      </div>

      <div style={sectionLbl}>Nutrient caps (advisory)</div>
      <Check name="no_manufactured_fert" def={a?.no_manufactured_fert} label="No manufactured / inorganic fertiliser at all" />
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <Num name="manufactured_n_cap_kg_ha" def={a?.manufactured_n_cap_kg_ha} ph="Manufactured N cap" suffix="kg N/ha" />
        <Num name="total_n_cap_kg_ha" def={a?.total_n_cap_kg_ha} ph="Total N cap" suffix="kg N/ha" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Num name="organic_manure_cap_t_ha" def={a?.organic_manure_cap_t_ha} ph="FYM / manure cap" suffix="t/ha" />
        <Num name="organic_n_field_cap_kg_ha" def={a?.organic_n_field_cap_kg_ha} ph="Organic-N field cap" suffix="kg N/ha" />
      </div>
      <Check name="manure_cut_years_only" def={a?.manure_cut_years_only} label="FYM only in years the field is cut" />
      <div style={{ display: 'flex', gap: 18 }}>
        <Check name="no_phosphate" def={a?.no_phosphate} label="No phosphate" />
        <Check name="no_potash" def={a?.no_potash} label="No potash" />
      </div>

      <div style={sectionLbl}>Cutting / timing</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Md name="closed_cut_start_md" def={a?.closed_cut_start_md} label="No cut from" />
        <Md name="closed_cut_end_md" def={a?.closed_cut_end_md} label="No cut until" />
        <Md name="earliest_cut_md" def={a?.earliest_cut_md} label="No cut before" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Md name="manufactured_n_closed_start_md" def={a?.manufactured_n_closed_start_md} label="No N fert from" />
        <Md name="manufactured_n_closed_end_md" def={a?.manufactured_n_closed_end_md} label="No N fert until" />
      </div>

      <div style={sectionLbl}>Grazing / livestock</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Num name="livestock_exclusion_weeks_pre_cut" def={a?.livestock_exclusion_weeks_pre_cut} ph="Stock off before cut" suffix="weeks" />
        <Num name="max_stocking_lu_ha" def={a?.max_stocking_lu_ha} ph="Stocking cap" suffix="LU/ha" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <Md name="grazing_closed_start_md" def={a?.grazing_closed_start_md} label="No grazing from" />
        <Md name="grazing_closed_end_md" def={a?.grazing_closed_end_md} label="No grazing until" />
      </div>
      <div style={{ display: 'flex', gap: 18 }}>
        <Check name="no_supplementary_feeding" def={a?.no_supplementary_feeding} label="No supplementary feeding" />
        <Check name="mineral_blocks_allowed" def={a?.mineral_blocks_allowed} label="…but mineral blocks ok" />
      </div>

      <div style={sectionLbl}>Other</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Num name="min_ph" def={a?.min_ph} ph="Lime to maintain pH" />
        <div style={{ flex: 2 }}>
          <label style={lbl}>Note</label>
          <input name="note" defaultValue={a?.note ?? ''} placeholder="anything not captured above" style={inp} />
        </div>
      </div>

      <button type="submit" className="btn-primary" style={{ marginTop: 18, width: '100%' }}>{submitLabel}</button>
    </form>
  );
}
