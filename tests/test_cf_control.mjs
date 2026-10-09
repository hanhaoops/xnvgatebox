import assert from 'node:assert/strict';
import { handleRequest } from '../worker/control/worker.mjs';

const future = new Date(Date.now() + 3600_000).toISOString();
const manifest = {
  schema_version: 1,
  kind: 'vpngate_cf_validated_nodes',
  generated_at: new Date(Date.now() - 60_000).toISOString(),
  expires_at: future,
  scope: 'tcp_ipv4_ws',
  data_plane: { host: 'vpngate-edge.example.com', port: 443, base_path: '/' },
  nodes: [{
    node_id: 'vpngate-us-001', hostname: 'public-vpn-1.opengw.net', country: 'US',
    sstp_host: 'public-vpn-1.opengw.net', sstp_port: 443,
    expected_exit_ip: '73.1.1.1', actual_exit_ip: '73.1.1.1',
    asn: 'AS7922', isp: 'Comcast', ip_type: 'likely_residential', latency_ms: 120,
    verified_at: new Date(Date.now() - 60_000).toISOString(), expires_at: future,
  }],
};

const env = {
  VLESS_UUID: '12345678-1234-4123-8123-123456789abc', ADMIN_TOKEN: 'admin-secret', SUB_TOKEN: 'sub-secret',
  VPN_USERNAME: 'vpn', VPN_PASSWORD: 'p@ss&=?', MANIFEST: { async get(key) { assert.equal(key, 'manifest:current'); return manifest; } },
};
const request = (path, init = {}) => new Request('https://control.example.com' + path, init);
const auth = { authorization: 'Bearer admin-secret' };

let response = await handleRequest(request('/health'), env);
assert.equal(response.status, 200);
assert.equal((await response.json()).manifest_ready, true);

response = await handleRequest(request('/api/status'), env);
assert.equal(response.status, 401);

response = await handleRequest(request('/api/status', { headers: auth }), env);
assert.equal(response.status, 200);
assert.equal((await response.json()).nodes[0].expected_exit_ip, '73.1.1.1');

response = await handleRequest(request('/sub?token=wrong'), env);
assert.equal(response.status, 401);
response = await handleRequest(request('/sub?token=sub-secret'), env);
assert.equal(response.status, 200);
const links = atob((await response.text()).trim()).trim().split('\n');
assert.equal(links.length, 1);
assert.match(links[0], /^vless:\/\/12345678-1234-4123-8123-123456789abc@vpngate-edge\.example\.com:443\?/);
const path = new URL(links[0]).searchParams.get('path');
assert.equal(new URL('https://edge.invalid' + path).searchParams.get('sstp'), 'vpn:p%40ss%26%3D%3F@public-vpn-1.opengw.net:443');
assert.equal(new URL('https://edge.invalid' + path).searchParams.get('globalproxy'), '1');

const stale = structuredClone(manifest);
stale.expires_at = '2000-01-01T00:00:00Z';
response = await handleRequest(request('/sub?token=sub-secret'), { ...env, MANIFEST: { async get() { return stale; } } });
assert.equal(response.status, 503);

const invalid = structuredClone(manifest);
invalid.nodes[0].sstp_host = 'attacker.example.com';
response = await handleRequest(request('/sub?token=sub-secret'), { ...env, MANIFEST: { async get() { return invalid; } } });
assert.equal(response.status, 503);

const unifiedEnv = {
  ...env,
  PUBLIC_HOST: 'xnvgatebox.example.workers.dev',
  CHECKER_TOKEN: 'checker-secret',
  LEGACY_CHECKER_URL: 'https://checker.invalid/check',
  LEGACY_EDGE_URL: 'https://edge.invalid',
};
response = await handleRequest(request('/health'), unifiedEnv);
const unifiedHealth = await response.json();
assert.equal(unifiedHealth.service, 'xnvgatebox');
assert.deepEqual(unifiedHealth.modules, { management: true, subscription: true, checker: true, data_plane: true });

const originalFetch = globalThis.fetch;
globalThis.fetch = async (forwarded) => {
  assert.match(forwarded.url, /^https:\/\/(checker|edge)\.invalid/);
  return new Response('forwarded', { status: 200 });
};
const checkerPath = '/check?proxy=' + encodeURIComponent('sstp://vpn:vpn@public-vpn-1.opengw.net:443');
response = await handleRequest(request(checkerPath, { headers: { authorization: 'Bearer checker-secret' } }), unifiedEnv);
assert.equal(response.status, 200);
const edgePath = '/?sstp=' + encodeURIComponent('vpn:vpn@public-vpn-1.opengw.net:443') + '&globalproxy=1';
response = await handleRequest(request(edgePath, { headers: { upgrade: 'websocket' } }), unifiedEnv);
assert.equal(response.status, 200);
response = await handleRequest(request('/sub?token=sub-secret'), unifiedEnv);
const unifiedLinks = atob((await response.text()).trim()).trim().split('\n');
assert.match(unifiedLinks[0], /@xnvgatebox\.example\.workers\.dev:443\?/);
globalThis.fetch = originalFetch;

console.log('Cloudflare unified Worker tests passed');
