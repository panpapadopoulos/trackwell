/** Content-Security-Policy for the served SPA. */
/** sha256 of the inline theme script in index.html (kept in sync by worker/src/csp.test.ts). */
export const THEME_SCRIPT_HASH = 'sha256-MdEbIw9abPEd/NHnegux9DCATIndVHFBC2dA1FWE7QA=';

export const CSP = [
  "default-src 'self'",
  `script-src 'self' '${THEME_SCRIPT_HASH}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');
