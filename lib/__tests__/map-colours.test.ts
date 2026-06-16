import { describe, it, expect } from 'vitest';
import {
  statusColourFor, indexColour, buildColouring, valueLabelFor, COLOURS,
  type ColourField,
} from '../map-colours';

const F = (over: Partial<ColourField>): ColourField => ({
  id: 'f', name: 'Field', ha: 1, p_idx: null, k_idx: null, boundary: { type: 'Polygon', coordinates: [] }, ...over,
});

describe('indexColour', () => {
  it('maps soil index to status colour', () => {
    expect(indexColour(null)).toBe(COLOURS.unknown);
    expect(indexColour(0)).toBe(COLOURS.bad);
    expect(indexColour(1)).toBe(COLOURS.bad);
    expect(indexColour(2)).toBe(COLOURS.good);
    expect(indexColour(3)).toBe(COLOURS.warn);
  });
});

describe('statusColourFor', () => {
  it('ph uses limeStatus', () => {
    expect(statusColourFor(F({ limeStatus: 'ok' }), 'ph')).toBe(COLOURS.good);
    expect(statusColourFor(F({ limeStatus: 'low' }), 'ph')).toBe(COLOURS.warn);
    expect(statusColourFor(F({ limeStatus: 'due' }), 'ph')).toBe(COLOURS.bad);
    expect(statusColourFor(F({ limeStatus: 'unknown' }), 'ph')).toBe(COLOURS.unknown);
    expect(statusColourFor(F({}), 'ph')).toBe(COLOURS.unknown);
  });
  it('p/k use the index', () => {
    expect(statusColourFor(F({ p_idx: 2 }), 'p')).toBe(COLOURS.good);
    expect(statusColourFor(F({ k_idx: 0 }), 'k')).toBe(COLOURS.bad);
  });
  it('none is neutral', () => {
    expect(statusColourFor(F({}), 'none')).toBe(COLOURS.neutral);
  });
});

describe('buildColouring — gradient modes', () => {
  it('ph legend + colourOf', () => {
    const { colourOf, legend } = buildColouring([F({ limeStatus: 'due' })], 'ph', { block: {}, type: {}, agreement: {} });
    expect(colourOf(F({ limeStatus: 'due' }))).toBe(COLOURS.bad);
    expect(legend).toHaveLength(4);
    expect(legend[0].label).toContain('target');
  });
  it('none has empty legend', () => {
    expect(buildColouring([], 'none', { block: {}, type: {}, agreement: {} }).legend).toEqual([]);
  });
});

describe('buildColouring — categorical', () => {
  const fields = [
    F({ id: 'a', group_id: 'home', allocation_type_id: 'sil', agreementIds: ['sam3'] }),
    F({ id: 'b', group_id: 'away', allocation_type_id: null, agreementIds: [] }),
    F({ id: 'c', group_id: 'home', allocation_type_id: 'sil', agreementIds: ['gs6', 'sam3'] }),
  ];
  const labels = {
    block: { home: 'Home', away: 'Away' },
    type: { sil: 'Silage' },
    agreement: { sam3: 'SAM3', gs6: 'GS6' },
  };

  it('block: distinct colour per value, sorted by label, plus a "no block" entry only when needed', () => {
    const { colourOf, legend } = buildColouring(fields, 'block', labels);
    // two blocks present, both assigned, both labels in legend
    expect(legend.map((l) => l.label)).toEqual(['Away', 'Home']); // sorted by label
    // same block → same colour; different block → different colour
    expect(colourOf(fields[0])).toBe(colourOf(fields[2]));
    expect(colourOf(fields[0])).not.toBe(colourOf(fields[1]));
    // every field has a block here → no "No block" entry
    expect(legend.find((l) => l.label === 'No block')).toBeUndefined();
  });

  it('type: adds an Untyped entry because one field is untyped', () => {
    const { colourOf, legend } = buildColouring(fields, 'type', labels);
    expect(legend.find((l) => l.label === 'Untyped')).toBeDefined();
    expect(colourOf(fields[1])).toBe(COLOURS.unknown); // untyped → grey
  });

  it('agreement: colours by FIRST agreement, adds "No agreement" for the field with none', () => {
    const { colourOf, legend } = buildColouring(fields, 'agreement', labels);
    // field b has no agreement → grey + legend entry
    expect(colourOf(fields[1])).toBe(COLOURS.unknown);
    expect(legend.find((l) => l.label === 'No agreement')).toBeDefined();
    // field c's first agreement is gs6 → coloured as GS6, not SAM3
    expect(colourOf(fields[2])).toBe(colourOf(F({ agreementIds: ['gs6'] })));
  });
});

describe('valueLabelFor', () => {
  const labels = { block: { home: 'Home' }, type: { sil: 'Silage' }, agreement: { sam3: 'SAM3', gs6: 'GS6' } };
  it('formats per mode', () => {
    expect(valueLabelFor(F({ ph: 6.1 }), 'ph', labels)).toBe('pH 6.1');
    expect(valueLabelFor(F({ p_idx: 2 }), 'p', labels)).toBe('P index 2');
    expect(valueLabelFor(F({ k_idx: null }), 'k', labels)).toBe('K not sampled');
    expect(valueLabelFor(F({ group_id: 'home' }), 'block', labels)).toBe('Home');
    expect(valueLabelFor(F({ allocation_type_id: null }), 'type', labels)).toBe('Untyped');
    expect(valueLabelFor(F({ agreementIds: ['sam3', 'gs6'] }), 'agreement', labels)).toBe('SAM3 +1');
    expect(valueLabelFor(F({ agreementIds: [] }), 'agreement', labels)).toBe('No agreement');
  });
});
