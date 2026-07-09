// Strips HTML tags and control characters from text lifted off a fetched page,
// so a malicious page can't reflect markup into findings (and, if the frontend
// ever renders a finding as HTML, can't turn it into stored XSS). Printable
// Unicode (accents, etc.) is kept.
export function plainText(input: string, max = 200): string {
  const withoutTags = input.replace(/<[^>]*>/g, ' ');
  let out = '';
  for (const ch of withoutTags) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}
