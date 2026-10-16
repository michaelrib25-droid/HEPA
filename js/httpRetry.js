const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;

// Both OFF's barcode endpoint and FDC's search endpoint have been observed
// returning fast, transient 5xx responses independent of the request itself
// (confirmed via repeated direct testing) — a couple of quick retries clears
// most of them without meaningfully delaying a genuine offline/timeout
// failure, which still fails after a single full timeout since retrying a
// hung connection rarely helps.
//
// 429 and 400 are also retried: api.data.gov's gateway has been observed
// returning a transient 400 for a URL that succeeded seconds earlier with
// identical parameters, and 429 is a standard "back off and retry" signal.
// 404 is deliberately NOT retried — callers (e.g. barcodeLookup.js) use it
// as a meaningful "not found" signal that won't change on retry.
const RETRYABLE_CLIENT_STATUSES = new Set([400, 429]);
export async function fetchWithRetry(url, options = {}) {
  const {
    label = 'Request',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res;
    const retryable = res.status >= 500 || RETRYABLE_CLIENT_STATUSES.has(res.status);
    if (!retryable || attempt === maxAttempts) {
      const err = new Error(`${label} failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
