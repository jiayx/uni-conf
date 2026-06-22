import { describe, expect, it } from 'vitest';
import { resolveDueSources } from './source-auto-refresh';

const nowMs = Date.parse('2026-06-21T12:00:00.000Z');

describe('source auto refresh', () => {
  it('refreshes never-updated sources', () => {
    expect(resolveDueSources([
      { id: 'source-1', last_updated: null, update_interval: 0 },
    ], 60, nowMs).map(source => source.id)).toEqual(['source-1']);
  });

  it('uses per-source update interval before global interval', () => {
    const sources = [
      { id: 'global-not-due', last_updated: '2026-06-21T11:30:00.000Z', update_interval: 0 },
      { id: 'source-due', last_updated: '2026-06-21T11:30:00.000Z', update_interval: 20 },
      { id: 'source-not-due', last_updated: '2026-06-21T11:50:00.000Z', update_interval: 20 },
    ];

    expect(resolveDueSources(sources, 60, nowMs).map(source => source.id)).toEqual(['source-due']);
  });

  it('defaults the global interval to twenty four hours', () => {
    const sources = [
      { id: 'not-due', last_updated: '2026-06-21T11:00:00.000Z', update_interval: 0 },
      { id: 'due', last_updated: '2026-06-20T11:59:00.000Z', update_interval: 0 },
    ];

    expect(resolveDueSources(sources, 0, nowMs).map(source => source.id)).toEqual(['due']);
  });

  it('treats invalid timestamps as due', () => {
    expect(resolveDueSources([
      { id: 'source-1', last_updated: 'not-a-date', update_interval: 60 },
    ], 60, nowMs).map(source => source.id)).toEqual(['source-1']);
  });

  it('enforces a minimum five minute interval', () => {
    const sources = [
      { id: 'too-soon', last_updated: '2026-06-21T11:57:00.000Z', update_interval: 1 },
      { id: 'due', last_updated: '2026-06-21T11:54:00.000Z', update_interval: 1 },
    ];

    expect(resolveDueSources(sources, 1, nowMs).map(source => source.id)).toEqual(['due']);
  });
});
