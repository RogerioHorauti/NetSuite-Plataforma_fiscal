// Rodada 11 pelo NetSuite — régua nova do hml (27 UFs, cesta básica, FECP/FECOEP, monofásico de combustível):
// um pedido de venda interna por UF (location e cliente contribuinte da UF, natureza VENDA) com uma amostra fixa
// de NCM: cesta básica, combustíveis e itens de controle. Um item por NCM (o primeiro CEST, se houver vários).
// Retomável pelo memo "FP REGUA <UF>". Saída r11_ns_pedidos.jsonl; quem lê é a8_ns_ncm.js (PEDIDOS=) e d9_regua.js.
// Uso: node f9_ns_regua.js [UF...]
const fs = require('fs'); const { call } = require('./ns.js');
const L = require('./locations_uf.json'), C = require('./clientes_uf.json');
const PAR = +(process.env.PAR || 2), NAT = process.env.NAT || '16', LOG = 'r11_ns_pedidos.jsonl';
const AMOSTRA = {
  cesta: ['10063021', '10063011', '07133319', '07133399', '09012100', '04012010', '04021010', '17019900', '17011400', '11010010',
    '11062000', '15079011', '25010020', '02013000', '02071400', '04072100', '19059090', '19021900', '04051000', '07019000', '08039000', '03028990'],
  combustivel: ['27101259', '27101921', '22071090', '27111910'],
  controle: ['84713012', '22030000', '24022000', '30049099', '33030010', '87032310']
};
const NCMS = Object.values(AMOSTRA).flat();
async function todos(q) {
  const out = []; for (let off = 0; ; off += 1000) {
    const r = JSON.parse((await call('POST', '/query/v1/suiteql?limit=1000&offset=' + off, { q })).body);
    out.push(...r.items); if (!r.hasMore) return out;
  }
}
(async () => {
  const achados = await todos("select id, itemid from item where isinactive='F' and (" + NCMS.map(n => "itemid like 'FP-NCM-" + n + "%'").join(' or ') + ") order by itemid");
  const porNcm = {}; achados.forEach(x => { const n = x.itemid.slice(7, 15); if (!porNcm[n]) porNcm[n] = x.id; });
  const faltam = NCMS.filter(n => !porNcm[n]); if (faltam.length) console.log('sem item:', faltam.join(' '));
  const ids = NCMS.filter(n => porNcm[n]).map(n => porNcm[n]);
  const feitos = new Set((await todos("select memo from transaction where type='SalesOrd' and memo like 'FP REGUA %'")).map(x => x.memo));
  const ufs = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(L).sort();
  const fila = ufs.map(uf => ({ uf, memo: 'FP REGUA ' + uf })).filter(p => !feitos.has(p.memo));
  console.log('linhas por pedido', ids.length, '| a fazer', fila.length);
  let k = 0;
  await Promise.all(Array.from({ length: PAR }, async () => {
    while (k < fila.length) {
      const p = fila[k++]; const t0 = Date.now();
      const body = { entity: { id: C[p.uf] }, subsidiary: { id: '3' }, location: { id: L[p.uf] }, customForm: { id: '111' }, currency: { id: '5' },
        tranDate: '2026-10-21', memo: p.memo, custbody_fp_natureza: { id: NAT },
        item: { items: ids.map(i => ({ item: { id: i }, quantity: 1, rate: 100, taxCode: { id: '5' } })) } };
      let r;
      for (let t = 0; t < 6; t++) {
        try { r = await call('POST', '/record/v1/salesOrder', body); } catch (e) { r = { code: 'EXC', body: e.message }; }
        if (r.code === 429 || r.code === 'EXC' || r.code >= 500) { await new Promise(s => setTimeout(s, 5000 * (t + 1))); continue; }
        break;
      }
      const id = r.loc ? r.loc.split('/').pop() : null;
      fs.appendFileSync(LOG, JSON.stringify({ uf: p.uf, memo: p.memo, linhas: ids.length, id, code: r.code, s: Math.round((Date.now() - t0) / 1000), erro: id ? undefined : String(r.body).slice(0, 400) }) + '\n');
      console.log(p.memo, r.code, id || String(r.body).slice(0, 200), Math.round((Date.now() - t0) / 1000) + 's');
    }
  }));
})();
