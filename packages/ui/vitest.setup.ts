// What: Vitest global setup — jest-dom matchers for jsdom-based component tests
// Why: SubmitButton / LoadingArea tests need jest-dom matchers (toBeDisabled,
//      toBeInTheDocument, toHaveTextContent) and a DOM environment.
// Does NOT: Configure individual test mocks — those live in each test file.

import '@testing-library/jest-dom/vitest';

// Vitest 5 types `expect(x)` as `Assertion<R, T>`, which picks up custom matchers from its
// `Matchers<R, T>` interface. jest-dom (6.9 and 7.x) still augments the old one-parameter
// `Assertion<T>`, which no longer merges, so its matchers are added to `Matchers` here.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<unknown, R> {}
}
