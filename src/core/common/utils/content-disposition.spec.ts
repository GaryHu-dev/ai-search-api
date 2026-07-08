import { attachmentDisposition } from './content-disposition';

describe('attachmentDisposition', () => {
  it('passes a simple ASCII filename through', () => {
    expect(attachmentDisposition('report.pdf')).toBe(
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf',
    );
  });

  it('neutralises a quote that would terminate the header value', () => {
    expect(attachmentDisposition('a"b.pdf')).toContain('filename="a_b.pdf"');
  });

  it('strips control characters like newlines from the fallback', () => {
    const header = attachmentDisposition('a\nb.pdf');
    expect(header).toContain('filename="a_b.pdf"');
    expect(header).not.toContain('\n');
  });

  it('encodes non-ASCII names in the RFC 5987 form', () => {
    const header = attachmentDisposition('résumé.pdf');
    expect(header).toContain('filename="r_sum_.pdf"');
    expect(header).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf");
  });
});
