// F0 — alcance: que CFOPs do catálogo nenhuma natureza produz, e por quê (classificação mecânica).
const fs = require('fs');
const SEED = 'C:/Users/TI/Documents/GitHub/fiscal-platform/backend/src/database/seed/';
function tuplas(sql) {
  const out = []; let i = sql.indexOf('VALUES') + 6;
  while (i < sql.length) {
    const a = sql.indexOf('(', i); if (a < 0) break;
    const vals = []; let j = a + 1, cur = '', q = false;
    for (; j < sql.length; j++) {
      const ch = sql[j];
      if (q) { if (ch === "'" && sql[j + 1] === "'") { cur += "'"; j++; } else if (ch === "'") q = false; else cur += ch; }
      else if (ch === "'") q = true;
      else if (ch === ',') { vals.push(cur.trim()); cur = ''; }
      else if (ch === ')') { vals.push(cur.trim()); break; }
      else cur += ch;
    }
    out.push(vals); i = j + 1;
  }
  return out;
}
const cfopSql = fs.readFileSync(SEED + 'cfop.sql', 'utf8');
const cols = cfopSql.slice(cfopSql.indexOf('(') + 1, cfopSql.indexOf(')')).split(',').map(s => s.trim());
const cfops = tuplas(cfopSql).map(v => Object.fromEntries(cols.map((c, k) => [c, v[k]])));
const nat = JSON.parse(fs.readFileSync('naturezas_hml.json', 'utf8')); // GET /natureza-operacao gravado pelo f1_fumaca.js
const alc = new Set(); for (const n of nat) for (const c of [n.cfopInternoCodigo, n.cfopInterestadualCodigo, n.cfopExteriorCodigo]) if (c) alc.add(c);
const FORA = [[/energia/i, 'energia elétrica'], [/comunica|telecomunica/i, 'comunicação'], [/transporte|frete/i, 'transporte (CT-e)'], [/combust|lubrific/i, 'combustível']];
const linhas = [];
for (const c of cfops) {
  if (alc.has(c.codigo)) continue;
  let cat;
  if (c.vigencia_fim && c.vigencia_fim !== 'NULL') cat = 'revogado (vigência até ' + c.vigencia_fim.slice(0, 10) + ')';
  else if (c.ativo === 'false') cat = 'inativo no catálogo';
  else { const f = FORA.find(([re]) => re.test(c.descricao + ' ' + c.grupo)); cat = f ? 'fora do escopo NF-e: ' + f[1] : 'sem natureza'; }
  linhas.push({ codigo: c.codigo, cat, grupo: c.grupo, descricao: c.descricao });
}
const por = {}; for (const l of linhas) por[l.cat.replace(/ \(.*/, '')] = (por[l.cat.replace(/ \(.*/, '')] || 0) + 1;
console.log('catálogo', cfops.length, '| alcançados', alc.size, '| não alcançados', linhas.length); console.log(por);
fs.writeFileSync('f0_alcance.json', JSON.stringify(linhas, null, 1));
const g = {}; for (const l of linhas.filter(l => l.cat === 'sem natureza')) (g[l.grupo] = g[l.grupo] || []).push(l.codigo);
for (const [k, v] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) console.log(String(v.length).padStart(3), k);
