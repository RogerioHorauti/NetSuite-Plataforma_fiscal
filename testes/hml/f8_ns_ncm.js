// Rodada 10 pelo NetSuite — cada item FP-NCM (um por NCM × CEST) passa pelo bundle em cada UF:
// pedido de venda (natureza VENDA) na location da UF, para o cliente contribuinte da mesma UF.
// O beforeSubmit do bundle simula e grava FP-salesorder-<id>-payload/-retorno.json; quem lê é a8_ns_ncm.js.
// Lote de 100 e 2 em paralelo: o motor faz ~7 linhas/s no total e o N/https corta em 45 s (medido na rodada 10).
// NCM extinto (ativo=false no hml) vai num pedido próprio, em SP: ele é recusado e derrubaria o lote inteiro.
// Retomável: o memo "FP NCM <UF> <lote>" identifica o pedido já criado. Uso: node f8_ns_ncm.js [UF...]
const fs = require('fs'); const { call, sql } = require('./ns.js');
const LOTE = +(process.env.LOTE || 100), PAR = +(process.env.PAR || 2), NAT = process.env.NAT || '16';
const L = require('./locations_uf.json'), C = require('./clientes_uf.json');
const LOG = 'r10_ns_pedidos.jsonl';
async function todos(q) {
  const out = []; for (let off = 0; ; off += 1000) {
    const r = JSON.parse((await call('POST', '/query/v1/suiteql?limit=1000&offset=' + off, { q })).body);
    out.push(...r.items); if (!r.hasMore) return out;
  }
}
(async () => {
  const extintos = new Set(require('./r10_ncm_lista.json').filter(n => n.ativo === false).map(n => n.codigo.replace(/\D/g, '')));
  const todosItens = await todos("select id, itemid from item where itemid like 'FP-NCM-%' and isinactive='F' order by id");
  const extinto = x => extintos.has(x.itemid.slice(7, 15));
  const itens = todosItens.filter(x => !extinto(x)).map(x => x.id);
  const itensExtintos = todosItens.filter(extinto);
  const feitos = new Set((await todos("select memo from transaction where type='SalesOrd' and memo like 'FP NCM % %'")).map(x => x.memo));
  const ufs = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(L).sort();
  const fila = [];
  for (const uf of ufs) for (let i = 0, n = 1; i < itens.length; i += LOTE, n++) {
    const memo = 'FP NCM ' + uf + ' ' + String(n).padStart(3, '0');
    if (!feitos.has(memo)) fila.push({ uf, memo, ids: itens.slice(i, i + LOTE) });
  }
  itensExtintos.forEach(x => { const memo = 'FP NCM EXTINTO ' + x.itemid; if (!feitos.has(memo)) fila.unshift({ uf: 'SP', memo, ids: [x.id] }); });
  console.log('itens', itens.length, 'extintos', itensExtintos.length, 'UFs', ufs.length, 'pedidos feitos', feitos.size, 'a fazer', fila.length);
  let k = 0, ok = 0, falha = 0; const ini = Date.now();
  await Promise.all(Array.from({ length: PAR }, async () => {
    while (k < fila.length) {
      const p = fila[k++]; const t0 = Date.now();
      const body = { entity: { id: C[p.uf] }, subsidiary: { id: '3' }, location: { id: L[p.uf] }, customForm: { id: '111' }, currency: { id: '5' },
        tranDate: '2026-10-21', memo: p.memo, custbody_fp_natureza: { id: NAT },
        item: { items: p.ids.map(i => ({ item: { id: i }, quantity: 1, rate: 100, taxCode: { id: '5' } })) } };
      let r;
      for (let t = 0; t < 8; t++) {
        try { r = await call('POST', '/record/v1/salesOrder', body); } catch (e) { r = { code: 'EXC', body: e.message }; }
        if (r.code === 429 || r.code === 'EXC' || r.code >= 500) { await new Promise(s => setTimeout(s, 5000 * (t + 1))); continue; }
        break;
      }
      const id = r.loc ? r.loc.split('/').pop() : null;
      if (id) ok++; else falha++;
      fs.appendFileSync(LOG, JSON.stringify({ uf: p.uf, memo: p.memo, linhas: p.ids.length, id, code: r.code, s: Math.round((Date.now() - t0) / 1000), erro: id ? undefined : String(r.body).slice(0, 400) }) + '\n');
      console.log(new Date().toISOString().slice(11, 19), p.memo, r.code, id || '', Math.round((Date.now() - t0) / 1000) + 's', '| ok', ok, 'falha', falha, 'de', fila.length);
    }
  }));
  console.log('FIM ok', ok, 'falha', falha, Math.round((Date.now() - ini) / 60000) + ' min');
})();
