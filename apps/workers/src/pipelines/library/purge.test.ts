import { describe, expect, it } from 'vitest';
import { PURGE_AFTER_DAYS, isPurgeCandidate, purgeCutoff } from './purge.js';

const NOW = new Date('2026-07-27T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe('purgeCutoff', () => {
  it('resta exactamente PURGE_AFTER_DAYS días', () => {
    expect(purgeCutoff(NOW).getTime()).toBe(NOW.getTime() - PURGE_AFTER_DAYS * DAY_MS);
  });
});

describe('isPurgeCandidate', () => {
  it('candidato: sin usos, antiguo y sin referencias de beats', () => {
    expect(
      isPurgeCandidate({ timesUsed: 0, createdAt: days(100), referencedByBeats: false }, NOW),
    ).toBe(true);
  });

  it('no candidato si se ha usado alguna vez', () => {
    expect(
      isPurgeCandidate({ timesUsed: 1, createdAt: days(100), referencedByBeats: false }, NOW),
    ).toBe(false);
  });

  it('no candidato si es más reciente que el corte', () => {
    expect(
      isPurgeCandidate({ timesUsed: 0, createdAt: days(89), referencedByBeats: false }, NOW),
    ).toBe(false);
  });

  it('justo en el corte no es candidato (se exige estrictamente anterior)', () => {
    expect(
      isPurgeCandidate({ timesUsed: 0, createdAt: purgeCutoff(NOW), referencedByBeats: false }, NOW),
    ).toBe(false);
  });

  it('no candidato si algún beat lo referencia aunque times_used sea 0', () => {
    expect(
      isPurgeCandidate({ timesUsed: 0, createdAt: days(365), referencedByBeats: true }, NOW),
    ).toBe(false);
  });
});
