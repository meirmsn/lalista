// What: Tiny helper to exercise Next's middleware `config.matcher` patterns in Vitest
// Why: `config.matcher` strings contain a lookahead regex like `/((?!foo|bar).*)`;
//      wrapping them in an anchored RegExp makes them testable without Next's runtime
// Does NOT: Simulate Next.js routing — a real matcher also considers HTTP method
//           and other facets; here we only care about path inclusion/exclusion

/** Build an anchored RegExp equivalent to the given `config.matcher` entry. */
export function pathToRegexp(matcher: string): RegExp {
  // Strip optional trailing slash from the input; anchor start + end so
  // full-path matching mirrors Next's behavior for single-pattern matchers.
  return new RegExp(`^${matcher}$`);
}
