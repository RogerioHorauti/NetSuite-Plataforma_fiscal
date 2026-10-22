// Cliente do hml para o runner de testes. Lê a credencial da empresa no arquivo de credenciais
// em memória; NUNCA imprime client_id, client_secret nem token.
const fs = require('fs');
const BASE = 'https://hml.fiscalplatform.com.br/api/v1';
const ARQ = 'C:/Users/TI/Documents/GitHub/fiscal-platform/CREDENCIAIS_OAUTH_HML.md';
const tokens = {};

function credencial(cnpj) {
  const linha = fs.readFileSync(ARQ, 'utf8').split(/\r?\n/).find(l => l.startsWith('| ' + cnpj + ' |'));
  if (!linha) throw new Error('sem credencial para ' + cnpj);
  const c = linha.split('|').map(s => s.trim().replace(/`/g, ''));
  return { id: c[3], secret: c[4] };
}

async function token(cnpj) {
  const t = tokens[cnpj];
  if (t && t.ate > Date.now()) return t.v;
  const c = credencial(cnpj);
  const r = await fetch(BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret })
  });
  if (!r.ok) throw new Error('token ' + cnpj + ' HTTP ' + r.status);
  const j = await r.json();
  tokens[cnpj] = { v: j.access_token, ate: Date.now() + ((j.expires_in || 3600) - 300) * 1000 };
  return j.access_token;
}

async function call(cnpj, method, path, body) {
  const ini = Date.now();
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + await token(cnpj) },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await r.text();
  let json; try { json = JSON.parse(txt); } catch (e) { json = txt; }
  return { code: r.status, body: json, ms: Date.now() - ini };
}

module.exports = { call, token, BASE };
