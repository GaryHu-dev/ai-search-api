// Builds a safe Content-Disposition header from a user-supplied filename.
// Interpolating the raw name is unsafe: a double-quote can terminate the header
// value, and a control character (e.g. a newline) makes Node's HTTP layer throw
// while setting the header. We send a sanitised ASCII fallback plus an RFC 5987
// UTF-8 form so non-ASCII names still survive in clients that support it.
export function attachmentDisposition(filename: string): string {
  const asciiFallback = filename
    .replace(/[^\x20-\x7e]/g, '_') // drop control + non-ASCII characters
    .replace(/["\\]/g, '_'); // and quotes/backslashes that break the quoted string
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
