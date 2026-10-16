const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;

// Both OFF's barcode endpoint and FDC's search endpoint have been observed
// returning fast, transient 5xx responses independent of the request itself
// (confirmed via repeated direct testing) — a couple of quick retries clears
// most of them without meaningfully delaying a genuine offline/timeout
// failure, which still fails after a single full timeout since retrying a
// hung connection rarely helps.
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
    if (res.status < 500 || attempt === maxAttempts) {
      throw new Error(`${label} failed: ${res.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
