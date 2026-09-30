// Uso: node naturezas_tipos.js [--gravar] — calcula (e opcionalmente grava) os tipos de transação de
// cada natureza pela família do nome e pelo sentido E/S. Ids da lista -100 medidos por sonda.
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const D = __dirname, F = 'C:/Users/TI/Documents/GitHub/NetSuite-Plataforma_fiscal/Consumer Key  Client ID-1.txt';
const sql = q => { const o = execFileSync('node', [path.join(D, 'tba.js'), F, q], { maxBuffer: 1 << 24 }).toString(); return JSON.parse(o.slice(o.indexOf('\n[', o.indexOf('[200]')) + 1)); };
const NOME = { 5: 'Cash Sale', 6: 'Estimate', 7: 'Invoice', 10: 'Credit Memo', 15: 'Purchase Order', 16: 'Item Receipt', 17: 'Bill',
  20: 'Bill Credit', 31: 'Sales Order', 32: 'Item Fulfillment', 33: 'Return Authorisation', 43: 'Vendor Return Authorization', 48: 'Transfer Order' };
const REGRAS = [ // [sentido, teste do nome, tipos] — a PRIMEIRA que casa vale
  ['S', n => /^VENDA/.test(n), [6, 7, 31, 5]],
  ['S', n => /^(SAIDA_ATIVO|SIMPLES_FATURA|BONIFICACAO)$/.test(n), [7, 31, 32]],
  ['S', n => /^COMPL_/.test(n), [7]],
  ['S', n => /^(REMESSA_|INDUSTRIALIZACAO_ENCOMENDA|RETORNO_INDUST_)/.test(n), [31, 7, 32, 48]],
  ['S', n => /^TRANSFER/.test(n), [48, 32]],
  ['S', n => /^(DEVOL_COMPRA|DEVOL_IMPORT)/.test(n), [43, 20, 32]],
  ['E', n => /^ENTRADA_TRANSF/.test(n), [48, 16]],
  ['E', n => /^(COMPRA|FRETE_TOMADO|ENTRADA_)/.test(n), [15, 16, 17]],
  ['E', n => /^DEVOL_VENDA/.test(n), [33, 10, 16]],
  ['E', n => /^RETORNO_/.test(n), [33, 16, 48, 15, 17]]
];
const nats = sql("SELECT id, name, BUILTIN.DF(custrecord_fp_entrada_saida) es FROM customrecord_fp_natureza_operacao WHERE isinactive = 'F' ORDER BY name");
const sem = [], plano = [];
for (const n of nats) {
  const r = REGRAS.find(([es, t]) => es === n.es && t(n.name));
  if (!r) { sem.push(n.name + ' (' + n.es + ')'); continue; }
  plano.push({ id: n.id, name: n.name, es: n.es, tipos: r[2] });
}
for (const p of plano) console.log(p.name.padEnd(30), p.es, p.tipos.map(t => NOME[t]).join(', '));
console.log('\n' + plano.length + ' naturezas mapeadas · sem família: ' + (sem.length ? sem.join(', ') : 'nenhuma'));
if (process.argv.includes('--gravar')) {
  if (sem.length) throw new Error('há natureza sem família — não gravo nada');
  let ok = 0, falha = [];
  for (const p of plano) {
    fs.writeFileSync(path.join(D, '_nat.json'), JSON.stringify({ custrecord_fp_transacao_no: { items: p.tipos.map(t => ({ id: String(t) })) } }));
    const o = execFileSync('node', [path.join(D, 'tba.js'), F, 'REQ', 'PATCH', 'customrecord_fp_natureza_operacao/' + p.id + '?replace=custrecord_fp_transacao_no', path.join(D, '_nat.json')]).toString();
    if (/\[204\]/.test(o)) ok++; else falha.push(p.name + ': ' + o.slice(0, 200));
  }
  console.log('gravadas: ' + ok + ' · falhas: ' + (falha.length ? '\n' + falha.join('\n') : 'nenhuma'));
}
