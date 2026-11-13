import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync('public/sw.js', 'utf8');
const origin = 'https://stockpact.example';
const home = '/cape-town-shop-delivery.webp';
const water = '/listing-water.webp';
const coffee = '/listing-coffee.webp';
const cacheName = 'stockpact-built-in-media-v1';

type Hook = (event: { waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (response: Promise<Response>) => void;
  request?: { url: string; mode: string; method: string; destination: string; headers: Headers } }) => void;

function imageResponse(path: string, init: ResponseInit = { headers: { 'content-type': 'image/webp' } }, redirected = false) {
  const response = new Response('sample', init);
  Object.defineProperties(response, { url: { value: new URL(path, origin).href }, redirected: { value: redirected } });
  return response;
}

function worker(responses: Map<string, () => Response>) {
  const hooks = new Map<string, Hook>();
  const entries = new Map<string, Response>();
  const deleted: string[] = [];
  const requests: string[] = [];
  runInNewContext(source, {
    AbortController, Response, URL, setTimeout, clearTimeout,
    self: { location: { origin }, addEventListener: (event: string, handler: Hook) => hooks.set(event, handler),
      skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async (name: string) => {
      assert.equal(name, cacheName);
      return { put: async (key: string, response: Response) => { entries.set(key, response); }, match: async (key: string) => entries.get(key) };
    }, keys: async () => [cacheName, 'stockpact-built-in-media-v0', 'other-app-cache'],
    delete: async (key: string) => { deleted.push(key); } },
    fetch: async (input: string | { url: string }) => {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      requests.push(path);
      const response = responses.get(path);
      if (!response) throw new Error('Network unavailable');
      return response();
    },
  });
  const lifecycle = (event: string) => new Promise<void>((resolve, reject) => {
    hooks.get(event)?.({ waitUntil: (promise) => { promise.then(() => resolve(), reject); } });
  });
  const fetchAsset = (url: string, destination = 'image') => {
    let result: Promise<Response> | undefined;
    hooks.get('fetch')?.({ request: { url: new URL(url, origin).href, method: 'GET', destination, mode: 'same-origin', headers: new Headers() },
      respondWith: (response) => { result = response; } });
    return result;
  };
  return { lifecycle, fetchAsset, entries, deleted, requests };
}

test('service worker warms only built-in photos and serves them during a gateway interruption', async () => {
  const responses = new Map([
    [home, () => imageResponse(home)],
    [water, () => imageResponse(water, { status: 401, headers: { 'content-type': 'image/webp' } })],
    [coffee, () => imageResponse(coffee, { headers: { 'content-type': 'text/html' } })],
    ['/listing-oil.webp', () => imageResponse('/listing-oil.webp', undefined, true)],
  ]);
  const { lifecycle, fetchAsset, entries, deleted, requests } = worker(responses);
  await lifecycle('install');
  await lifecycle('activate');
  assert.deepEqual(deleted, ['stockpact-built-in-media-v0']);
  assert.deepEqual([...entries.keys()], [`${origin}${home}`]);
  const numberOfRequests = requests.length;
  responses.delete(home);
  assert.equal((await fetchAsset(home))?.headers.get('content-type'), 'image/webp');
  assert.equal((await fetchAsset(`${home}?stockpact-image-retry=1`))?.status, 200);
  assert.equal(requests.length, numberOfRequests);

  assert.equal(fetchAsset('/api/listing-photo?listingId=demo-water-a'), undefined);
  assert.equal(fetchAsset('/api/state'), undefined);
  assert.equal(fetchAsset('/_next/image?url=%2Flisting-water.webp&w=640&q=75'), undefined);
  assert.equal(fetchAsset('https://another-site.example/listing-water.webp'), undefined);
  assert.equal(fetchAsset(`${home}?private=example`), undefined);
  assert.equal(fetchAsset(home, 'script'), undefined);

  assert.equal((await fetchAsset(water))?.status, 401);
  assert.ok(!entries.has(`${origin}${water}`));
  responses.set(water, () => imageResponse(water));
  assert.equal((await fetchAsset(water))?.status, 200);
  assert.ok(entries.has(`${origin}${water}`));
});
