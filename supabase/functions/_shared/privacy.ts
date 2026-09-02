/** Minimal-risk persistence redaction. The model still receives the live text;
 * only stored transcripts are scrubbed for secrets/payment credentials. */
export function redactForStorage(input: string): string {
  let s = input;
  // payment-card-like sequences (13-19 digits with spaces/dashes)
  s = s.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[payment-card redacted]");
  // common API/token/password assignments
  s = s.replace(/\b(api[_ -]?key|secret|password|passwd|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
  // UK NI numbers
  s = s.replace(/\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, "[NI number redacted]");
  return s;
}
