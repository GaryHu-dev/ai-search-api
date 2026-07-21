import { plainText } from '../text';

describe('plainText', () => {
  it('strips HTML tags', () => {
    expect(plainText('<img src=x onerror=alert(1)>Hi')).toBe('Hi');
  });

  it('collapses whitespace and control characters', () => {
    expect(plainText('a\n\tb')).toBe('a b');
  });

  it('keeps accented characters', () => {
    expect(plainText('résumé')).toBe('résumé');
  });

  it('truncates to the max length', () => {
    expect(plainText('abcdef', 3)).toBe('abc');
  });
});
