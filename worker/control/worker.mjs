// xnvgatebox's single public Worker: management, subscription, checker facade,
// and data-plane facade share one entrypoint. Legacy upstreams are migration
// inputs only and are configured explicitly; they are not user-facing services.
// SPDX-License-Identifier: GPL-3.0-only

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NODE_HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.opengw\.net$/i;
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const BASE_PATH_RE = /^\/[A-Za-z0-9/_-]*$/;

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function text(value, status = 200, extra = {}) {
  return new Response(value, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

function tokenEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

function bearer(request, expected) {
  const value = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return Boolean(expected) && Boolean(match) && tokenEqual(match[1], expected);
}

function fresh(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function timestamp(value) {
  return Number.isFinite(Date.parse(value || ''));
}

function publicIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return false;
  const numbers = parts.map(Number);
  if (numbers.some(part => part > 255)) return false;
  const [a, b] = numbers;
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 0) &&
    !(a === 192 && b === 168) && !(a === 198 && (b === 18 || b === 19));
}

function validPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function upstreamUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function backendAuthority(value, allowFailureControl = false) {
  try {
    const proxy = new URL('sstp://' + String(value || ''));
    if ((!NODE_HOST_RE.test(proxy.hostname) && !(allowFailureControl && proxy.hostname === 'nonexistent.invalid')) || proxy.search || proxy.hash || (proxy.pathname && proxy.pathname !== '/')) return null;
    const port = Number(proxy.port || 443);
    if (!validPort(port)) return null;
    return { hostname: proxy.hostname.toLowerCase(), port };
  } catch {
    return null;
  }
}

function validCheckerRequest(url) {
  if ([...url.searchParams.keys()].some(key => key !== 'proxy') || url.searchParams.getAll('proxy').length !== 1) return false;
  const value = url.searchParams.get('proxy') || '';
  try {
    const proxy = new URL(value);
    return proxy.protocol === 'sstp:' && Boolean(backendAuthority(value.slice('sstp://'.length))) && !proxy.search && !proxy.hash && (!proxy.pathname || proxy.pathname === '/');
  } catch {
    return false;
  }
}

function validEdgeRequest(request, url) {
  if (request.method !== 'GET' || (request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return false;
  if ([...url.searchParams.keys()].some(key => !['sstp', 'globalproxy'].includes(key)) || url.searchParams.getAll('sstp').length !== 1 || url.searchParams.getAll('globalproxy').length !== 1 || url.searchParams.get('globalproxy') !== '1') return false;
  return Boolean(backendAuthority(url.searchParams.get('sstp'), true));
}

async function forward(request, target, extraHeaders = {}) {
  const headers = new Headers(request.headers);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return fetch(new Request(target.toString(), { method: request.method, headers, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body }));
}

function validateNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (typeof node.node_id !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(node.node_id)) return false;
  if (!NODE_HOST_RE.test(node.hostname || '') || !NODE_HOST_RE.test(node.sstp_host || '')) return false;
  if (node.hostname.toLowerCase() !== node.sstp_host.toLowerCase()) return false;
  if (!validPort(node.sstp_port) || !publicIpv4(node.expected_exit_ip)) return false;
  if (node.actual_exit_ip !== node.expected_exit_ip || !fresh(node.expires_at) || !timestamp(node.verified_at)) return false;
  return true;
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema_version !== 1 || manifest.kind !== 'vpngate_cf_validated_nodes') return false;
  if (!fresh(manifest.expires_at) || !Array.isArray(manifest.nodes) || manifest.nodes.length === 0) return false;
  if (manifest.nodes.some(node => !validateNode(node))) return false;
  return true;
}

async function readManifest(env) {
  try {
    if (env.MANIFEST && typeof env.MANIFEST.get === 'function') {
      const value = await env.MANIFEST.get('manifest:current', { type: 'json' });
      if (value) return value;
    }
    if (typeof env.MANIFEST_JSON === 'string' && env.MANIFEST_JSON) return JSON.parse(env.MANIFEST_JSON);
    if (env.MANIFEST_JSON && typeof env.MANIFEST_JSON === 'object') return env.MANIFEST_JSON;
  } catch {
    return null;
  }
  return null;
}

function dataPlane(env, manifest) {
  const value = manifest.data_plane || {};
  const host = String(env.PUBLIC_HOST || env.DATA_PLANE_HOST || value.host || '').toLowerCase();
  const port = Number(env.DATA_PLANE_PORT || value.port || 443);
  const basePath = String(env.DATA_PLANE_BASE_PATH || value.base_path || '/');
  if (!HOST_RE.test(host) || !host.includes('.') || !validPort(port) || !BASE_PATH_RE.test(basePath)) return null;
  return { host, port, basePath };
}

function makeLink(node, env, plane) {
  const uuid = String(env.VLESS_UUID || '');
  if (!UUID_RE.test(uuid)) return null;
  const username = encodeURIComponent(String(env.VPN_USERNAME || 'vpn'));
  const password = encodeURIComponent(String(env.VPN_PASSWORD || 'vpn'));
  const authority = `${username}:${password}@${node.sstp_host}:${node.sstp_port}`;
  const edgePath = `${plane.basePath}?${new URLSearchParams({ sstp: authority, globalproxy: '1' }).toString()}`;
  const query = new URLSearchParams({
    encryption: 'none', security: 'tls', type: 'ws', sni: plane.host, host: plane.host, path: edgePath,
  });
  return `vless://${uuid}@${plane.host}:${plane.port}?${query.toString()}#${encodeURIComponent(node.node_id)}`;
}

function adminPage() {
  return `<!doctype html><meta charset="utf-8"><title>xnvgatebox</title>
<style>body{font:15px system-ui;background:#111827;color:#e5e7eb;max-width:960px;margin:2rem auto;padding:0 1rem}button,input{font:inherit;padding:.55rem;margin:.25rem;background:#1f2937;color:inherit;border:1px solid #4b5563;border-radius:.35rem}button{cursor:pointer;background:#2563eb;border-color:#2563eb}pre{white-space:pre-wrap;background:#0b1220;padding:1rem;border-radius:.4rem}table{border-collapse:collapse;width:100%}td,th{padding:.45rem;border-bottom:1px solid #374151;text-align:left}</style>
<h1>xnvgatebox</h1><p>统一出口节点管理与订阅。订阅只来自最近一次完整验证的节点池。</p>
<input id="token" type="password" placeholder="Admin token"><button id="load">加载状态</button><button id="sub">复制订阅地址</button>
<pre id="summary">尚未加载</pre><div id="nodes"></div>
<script>
const token=document.querySelector('#token'), summary=document.querySelector('#summary'), nodes=document.querySelector('#nodes');
const headers=()=>({Authorization:'Bearer '+token.value});
document.querySelector('#load').onclick=async()=>{const r=await fetch('/api/status',{headers:headers()}); summary.textContent=await r.text(); if(r.ok){const d=JSON.parse(summary.textContent); nodes.innerHTML='<table><tr><th>节点</th><th>国家</th><th>出口 IP</th><th>类型</th><th>过期</th></tr>'+d.nodes.map(n=>'<tr><td>'+n.node_id+'</td><td>'+n.country+'</td><td>'+n.expected_exit_ip+'</td><td>'+n.ip_type+'</td><td>'+n.expires_at+'</td></tr>').join('')+'</table>';}};
document.querySelector('#sub').onclick=async()=>{const value=prompt('输入订阅 token（不会写入页面）'); if(!value)return; await navigator.clipboard.writeText(location.origin+'/sub?token='+encodeURIComponent(value)); alert('已复制订阅地址');};
</script>`;
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (request.method === 'GET' && path === '/health') {
    const manifest = await readManifest(env);
    const configured = UUID_RE.test(String(env.VLESS_UUID || '')) && Boolean(env.ADMIN_TOKEN) && Boolean(env.SUB_TOKEN);
    const checkerReady = Boolean(env.CHECKER_TOKEN) && Boolean(upstreamUrl(env.LEGACY_CHECKER_URL));
    const dataPlaneReady = Boolean(upstreamUrl(env.LEGACY_EDGE_URL));
    return json({ service: 'xnvgatebox', version: 2, configured,
      modules: { management: configured, subscription: configured, checker: checkerReady, data_plane: dataPlaneReady },
      manifest_ready: validateManifest(manifest), nodes: Array.isArray(manifest?.nodes) ? manifest.nodes.length : 0 });
  }
  if (request.method === 'GET' && path === '/admin') return new Response(adminPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

  if (path === '/check') {
    if (request.method !== 'GET' || !validCheckerRequest(url)) return json({ error: 'invalid_check' }, 400);
    if (!bearer(request, String(env.CHECKER_TOKEN || ''))) return json({ error: 'unauthorized' }, 401);
    const target = upstreamUrl(env.LEGACY_CHECKER_URL);
    if (!target) return json({ error: 'checker_unavailable' }, 503);
    target.search = url.search;
    try { return await forward(request, target, { 'authorization': `Bearer ${env.CHECKER_TOKEN}` }); }
    catch { return json({ error: 'checker_unavailable' }, 502); }
  }

  if (path === '/' && validEdgeRequest(request, url)) {
    const target = upstreamUrl(env.LEGACY_EDGE_URL);
    if (!target) return json({ error: 'data_plane_unavailable' }, 503);
    target.pathname = url.pathname;
    target.search = url.search;
    try { return await forward(request, target, { 'x-xnvgatebox-unified': '1' }); }
    catch { return json({ error: 'data_plane_unavailable' }, 502); }
  }
  if (request.method !== 'GET') return json({ error: 'not_found' }, 404);

  const adminToken = String(env.ADMIN_TOKEN || '');
  if (path === '/api/status' || path === '/api/manifest') {
    if (!bearer(request, adminToken)) return json({ error: 'unauthorized' }, 401);
    const manifest = await readManifest(env);
    if (!validateManifest(manifest)) return json({ error: 'manifest_unavailable' }, 503);
    if (path === '/api/manifest') return json(manifest);
    return json({ schema_version: manifest.schema_version, generated_at: manifest.generated_at,
      expires_at: manifest.expires_at, scope: manifest.scope, nodes: manifest.nodes });
  }
  if (path === '/sub') {
    const supplied = url.searchParams.get('token') || '';
    if (!tokenEqual(supplied, String(env.SUB_TOKEN || ''))) return text('unauthorized\n', 401);
    const manifest = await readManifest(env);
    if (!validateManifest(manifest)) return text('manifest_unavailable\n', 503);
    const plane = dataPlane(env, manifest);
    if (!plane) return text('data_plane_unavailable\n', 503);
    const links = manifest.nodes.map(node => makeLink(node, env, plane)).filter(Boolean);
    if (!links.length) return text('subscription_empty\n', 503);
    return text(btoa(links.join('\n') + '\n') + '\n', 200, { 'content-transfer-encoding': 'base64' });
  }
  return json({ error: 'not_found' }, 404);
}

export default { fetch: handleRequest };
