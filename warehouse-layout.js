'use strict';

/**
 * Extends the warehouse picking route to support location row E.
 * A/B run forward, C/D run back, and E continues forward.
 */
window.parseLocation = function parseLocation(code) {
  const raw = String(code ?? '').trim().toUpperCase();
  const match = raw.match(/^([ABCDE])[-\s]?(\d{1,2})(?:\.(5))?$/);
  if (!match) return { raw, label: raw || 'NO LOC', sort: [9999, 999, 999] };

  const aisle = match[1];
  const number = Number(match[2]);
  const half = match[3] ? 0.5 : 0;
  if (number < 1 || number > 12) return { raw, label: raw, sort: [9999, number, half] };

  const halfOrder = half ? 1 : 0;
  let major;

  if (aisle === 'A' || aisle === 'B') {
    const side = aisle === 'A' ? 0 : 1;
    major = ((number - 1) * 4) + (side * 2) + halfOrder;
  } else if (aisle === 'C' || aisle === 'D') {
    const side = aisle === 'C' ? 0 : 1;
    major = 100 + ((12 - number) * 4) + (side * 2) + halfOrder;
  } else {
    major = 200 + ((number - 1) * 2) + halfOrder;
  }

  return {
    raw,
    label: `${aisle}-${String(number).padStart(2, '0')}${half ? '.5' : ''}`,
    sort: [major, 0, 0]
  };
};
