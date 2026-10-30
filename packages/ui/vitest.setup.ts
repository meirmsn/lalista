// What: Vitest global setup — jest-dom matchers for jsdom-based component tests
// Why: SubmitButton / LoadingArea tests need jest-dom matchers (toBeDisabled,
//      toBeInTheDocument, toHaveTextContent) and a DOM environment.
// Does NOT: Configure individual test mocks — those live in each test file.

import '@testing-library/jest-dom/vitest';
