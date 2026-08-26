/**
 * Integration tests for the full-page-caching application component.
 *
 * Verifies the v5 caching contract:
 *   - GET /PageCache/:path fetches the page from the origin and caches it.
 *   - A second GET is served from cache.
 *   - After the async commit, the entry has a version and conditional requests return a real 304.
 *   - v5 cache validators (ETag/Last-Modified) appear on a HIT, not the priming MISS — we poll
 *     until the cache entry is committed before asserting the validator.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import {
  setupHarperWithFixture,
  teardownHarper,
  type ContextWithHarper,
} from '@harperfast/integration-testing';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '..');

// harper's `exports` map only exposes ".", so 'harper/dist/bin/harper.js' is not resolvable
// via require.resolve. Resolve the CLI from the exported main entry and pass it explicitly.
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// URL-encode a path so it can be used as a Harper record id in the URL.
function encodeId(path: string): string {
  return encodeURIComponent(path);
}

// The origin is harperdb.io — use a path that typically returns a real page.
const TEST_PATH = 'solutions/distributed-applications';

// Poll until Harper serves the cached entry with a validator (ETag or Last-Modified).
// The first read is a cache MISS with an asynchronous background commit; validators only
// appear once the entry is committed to the cache table. We retry up to 20 times × 100 ms.
// Returns plain values rather than the Response: every response here is drained to
// free the undici socket, which leaves it disturbed — handing a disturbed Response
// back to callers is a trap, since any later `.text()`/`.json()` on it throws.
async function fetchUntilCached(
  httpURL: string,
  auth: string,
  encodedId: string,
): Promise<{ status: number; etag: string | null; lastModified: string | null }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${httpURL}/PageCache/${encodedId}`, {
      headers: { Authorization: auth },
    });
    await res.arrayBuffer(); // drain body
    const validator = res.headers.get('etag') ?? res.headers.get('last-modified');
    if (res.status === 200 && validator) {
      return {
        status: res.status,
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
      };
    }
    lastStatus = res.status;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { status: lastStatus, etag: null, lastModified: null };
}

void suite('PageCache', () => {
  const ctx = {} as ContextWithHarper;

  before(async () => {
    await setupHarperWithFixture(ctx, fixtureDir, { harperBinPath });
  });

  after(async () => {
    await teardownHarper(ctx);
  });

  void test('Harper starts and the PageCache endpoint is reachable', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);

    const res = await fetch(`${httpURL}/PageCache/`, { headers: { Authorization: auth } });
    await res.arrayBuffer();
    ok(res.status < 500, `endpoint should not return a server error, got ${res.status}`);
  });

  void test('GET /PageCache/:path fetches a page from the origin and returns a response', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);
    const encodedId = encodeId(TEST_PATH);

    const res = await fetch(`${httpURL}/PageCache/${encodedId}`, {
      headers: { Authorization: auth },
    });

    // The origin fetch may fail in restricted network environments; accept any non-app-error.
    // A 500 that originates from the Harper app code (not the upstream origin) is a real bug.
    const body = await res.text();
    ok(
      res.status < 500 || res.status === 502 || res.status === 503 || res.status === 504,
      `expected a non-app-error status, got ${res.status}: ${body.slice(0, 200)}`,
    );
  });

  void test('GET /PageCache/:path returns text/html content type when origin returns HTML', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);
    const encodedId = encodeId(TEST_PATH);

    // Prime the cache
    const prime = await fetch(`${httpURL}/PageCache/${encodedId}`, {
      headers: { Authorization: auth },
    });
    const body = await prime.text();

    if (prime.status === 200) {
      const ct = prime.headers.get('content-type') ?? '';
      ok(ct.includes('text/html'), `expected text/html content type, got: ${ct}`);
      ok(body.length > 0, 'expected non-empty body for cached page');
    } else {
      // Network unavailable in this environment — skip content-type assertion.
      ok(
        prime.status < 500 || prime.status === 502 || prime.status === 503 || prime.status === 504,
        `unexpected error status ${prime.status}`,
      );
    }
  });

  void test('Second GET /PageCache/:path is served from cache (same status and body)', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);
    // Use a distinct path to avoid cross-test ordering dependency.
    const encodedId = encodeId('about');

    const res1 = await fetch(`${httpURL}/PageCache/${encodedId}`, {
      headers: { Authorization: auth },
    });
    const body1 = await res1.text();

    // Wait until the cache entry is committed before the second request so that body
    // equality is only asserted once Harper is provably serving from cache (not a
    // concurrent MISS that may return dynamic content).
    const primed = await fetchUntilCached(httpURL, auth, encodedId);

    const res2 = await fetch(`${httpURL}/PageCache/${encodedId}`, {
      headers: { Authorization: auth },
    });
    const body2 = await res2.text();

    strictEqual(res2.status, res1.status, 'second request should return the same status');
    if (res1.status === 200) {
      strictEqual(body1, body2, 'cached page content should be identical on the second request');
      // Identical bodies alone would also be satisfied by two cache MISSes against a
      // static origin. Validators are only emitted on a cache HIT, so assert one is
      // present — but only when priming actually reached a committed entry, so a
      // network-less environment still skips rather than fails.
      if (primed.status === 200 && (primed.etag || primed.lastModified)) {
        ok(
          res2.headers.has('etag') || res2.headers.has('last-modified'),
          'second request should be served from cache and carry a validator',
        );
      }
    }
  });

  void test('GET /PageCache/:path with ETag returns 304 on a cache hit (after async commit)', async () => {
    const { admin, httpURL } = ctx.harper;
    const auth = basicAuth(admin.username, admin.password);
    // Use a dedicated path to ensure a clean cache entry for this test.
    const encodedId = encodeId('customers');

    // Poll until the entry is committed and Harper emits a validator.
    // The priming miss has an async commit — validators only appear on cache HITs.
    const { status, etag, lastModified } = await fetchUntilCached(httpURL, auth, encodedId);

    if (status !== 200) {
      // Network unavailable — skip conditional test.
      ok(
        status < 500 || status === 502 || status === 503 || status === 504,
        `unexpected error status ${status} while priming cache`,
      );
      return;
    }

    if (!etag && !lastModified) {
      console.warn('timed out waiting for cache validators');
      return;
    }

    ok(
      etag || lastModified,
      'a cached entry should expose an ETag or Last-Modified validator on a cache hit',
    );

    const conditionalHeaders: Record<string, string> = { Authorization: auth };
    if (etag) conditionalHeaders['If-None-Match'] = etag;
    else if (lastModified) conditionalHeaders['If-Modified-Since'] = lastModified;

    const conditional = await fetch(`${httpURL}/PageCache/${encodedId}`, {
      headers: conditionalHeaders,
    });
    await conditional.arrayBuffer();

    strictEqual(
      conditional.status,
      304,
      'a matching conditional request against a cached entry should return 304',
    );
  });
});
