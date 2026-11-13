import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request as proxyRequest } from 'node:http';

const origin = new URL(process.env.STOCKPACT_PHONE_ORIGIN);
const accessCode = process.env.STOCKPACT_PHONE_ACCESS_CODE;
const key = process.env.STOCKPACT_PHONE_SESSION_KEY;
if (origin.protocol !== 'https:' || origin.href !== origin.origin + '/' ||
    !/^[A-Za-z0-9_-]{24,64}$/.test(accessCode ?? '') || !/^[a-f0-9]{64}$/.test(key ?? '')) {
  throw new Error('Configure the StockPact phone origin, access code and session key.');
}

const loginPath = '/_stockpact/access';
const sessionCookie = '__Host-stockpact-phone';
const sessionSeconds = 48 * 60 * 60;
const hash = (value) => createHash('sha256').update(value).digest();
const accessHash = hash(accessCode);
const sign = (value) => createHmac('sha256', key).update(value).digest('base64url');
const cookieHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'];
let attempts = 0;
let nextWindow = 0;

function signedIn(cookies) {
  const entry = cookies.find((cookie) => cookie.startsWith(sessionCookie + '='));
  const token = entry?.slice(sessionCookie.length + 1);
  const match = /^(\d{10}\.[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  return !!match && Number(match[1].split('.')[0]) > Date.now() / 1000 &&
    timingSafeEqual(Buffer.from(sign(match[1])), Buffer.from(match[2]));
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { ...cookieHeaders, ...headers, location }).end();
}

function loginPage(response, status = 200, message = '') {
  response.writeHead(status, {
    ...cookieHeaders, 'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'referrer-policy': 'same-origin',
  }).end(`<!doctype html><html lang="en-ZA"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to StockPact</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f8f4eb;color:#211b17;font:16px/1.5 system-ui}
main{width:min(calc(100% - 32px),420px);margin:12vh auto;padding:24px;background:#fffdf8;border:1px solid #e7ded0;border-radius:16px}
h1{margin:0;font-size:30px;letter-spacing:-.04em}p{margin:8px 0 20px}label{font-weight:650}
input,button{display:block;width:100%;min-height:48px;padding:10px 12px;margin-top:8px;border-radius:8px;font:inherit}
input{border:1px solid #8b795e;background:white}button{border:1px solid #dfb229;background:#ffd33d;color:inherit;font-weight:700}
[role=alert]{color:#882b25}</style><main><h1>StockPact</h1><p>Enter your access code to open the private demo workspace.</p>
${message ? `<p role="alert">${message}</p>` : ''}
<form method="post" action="${loginPath}"><label for="code">Workspace access code</label>
<input id="code" name="code" type="password" required maxlength="64" autocomplete="current-password" autocapitalize="none">
<button type="submit">Open workspace</button></form></main></html>`);
}

async function login(incoming, response) {
  if (incoming.headers.origin !== origin.origin ||
      incoming.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    return loginPage(response, 403, 'Open the StockPact sign-in page to enter your code.');
  }
  const now = Date.now();
  if (now >= nextWindow) {
    attempts = 0;
    nextWindow = now + 60_000;
  }
  if (++attempts > 15) return loginPage(response, 429, 'Wait a minute before trying again.');
  let size = 0;
  const chunks = [];
  for await (const chunk of incoming) {
    size += chunk.length;
    if (size > 512) return loginPage(response, 413, 'Enter the workspace access code.');
    chunks.push(chunk);
  }
  const code = new URLSearchParams(Buffer.concat(chunks).toString()).get('code')?.trim() ?? '';
  if (!timingSafeEqual(hash(code), accessHash)) return loginPage(response, 401, 'That access code did not match.');
  const token = `${Math.floor(now / 1000) + sessionSeconds}.${randomBytes(16).toString('base64url')}`;
  redirect(response, '/', {
    'set-cookie': `${sessionCookie}=${token}.${sign(token)}; Path=/; Max-Age=${sessionSeconds}; Secure; HttpOnly; SameSite=Lax`,
  });
}

function forward(incoming, response, cookies) {
  const headers = { ...incoming.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': origin.host };
  for (const name of [...hopByHop, ...(incoming.headers.connection ?? '').toLowerCase().split(',').map((value) => value.trim())]) {
    delete headers[name];
  }
  const upstreamCookies = cookies.filter((cookie) => !cookie.startsWith(sessionCookie + '='));
  if (upstreamCookies.length) headers.cookie = upstreamCookies.join('; ');
  else delete headers.cookie;
  const upstream = proxyRequest({
    hostname: 'localhost', port: process.env.STOCKPACT_PHONE_UPSTREAM_PORT ?? 3112, path: incoming.url,
    method: incoming.method, headers,
  }, (result) => {
    for (const name of hopByHop) delete result.headers[name];
    response.writeHead(result.statusCode, { ...result.headers, 'cache-control': 'private, no-store' });
    result.on('error', () => response.destroy());
    result.pipe(response);
  });
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(502, { ...cookieHeaders, 'content-type': 'text/plain; charset=utf-8' }).end('StockPact workspace unavailable');
  });
  response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
  incoming.pipe(upstream);
}

createServer(async (incoming, response) => {
  try {
    if (incoming.headers.host !== origin.host || !incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
      return response.writeHead(421, cookieHeaders).end();
    }
    const path = new URL(incoming.url, origin).pathname;
    const cookies = (incoming.headers.cookie ?? '').split(';').map((cookie) => cookie.trim());
    if (path === loginPath && incoming.method === 'POST') return await login(incoming, response);
    if (path === loginPath && incoming.method === 'GET') {
      return signedIn(cookies) ? redirect(response, '/') : loginPage(response);
    }
    if (!signedIn(cookies)) {
      if (incoming.method === 'GET' && (incoming.headers['sec-fetch-mode'] === 'navigate' || path === '/')) {
        return redirect(response, loginPath);
      }
      return response.writeHead(401, { ...cookieHeaders, 'content-type': 'text/plain; charset=utf-8' }).end('Workspace access required');
    }
    forward(incoming, response, cookies);
  } catch {
    if (response.headersSent) response.destroy();
    else response.writeHead(400, cookieHeaders).end();
  }
}).listen(Number(process.env.STOCKPACT_PHONE_GATEWAY_PORT ?? 3116), '127.0.0.1');
