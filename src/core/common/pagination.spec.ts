import { parseSort } from './pagination';

describe('parseSort', () => {
  const allowed = ['createdAt', 'filename'];
  const fallback = { field: 'createdAt', order: 'desc' as const };

  it('falls back and tiebreaks on id when no sort is given', () => {
    expect(parseSort(undefined, allowed, fallback)).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('parses an ascending field', () => {
    expect(parseSort('filename', allowed, fallback)).toEqual([
      { filename: 'asc' },
      { id: 'desc' },
    ]);
  });

  it('parses a descending field with a "-" prefix', () => {
    expect(parseSort('-filename', allowed, fallback)).toEqual([
      { filename: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('ignores a field that is not allow-listed (prevents arbitrary sorts)', () => {
    expect(parseSort('passwordHash', allowed, fallback)).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('does not double-tiebreak when sorting by id itself', () => {
    expect(parseSort('-id', ['id'], fallback)).toEqual([{ id: 'desc' }]);
  });
});
