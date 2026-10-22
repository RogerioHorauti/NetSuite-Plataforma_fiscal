// Rodada 12 pelo NetSuite — monofásico depois da régua de 21/10 (fiscal-platform 39a19a4b: combustível da LC 192
// sem cProdANP → 400, CFOP 5.65x e PIS/COFINS 04 na revenda). Dois pedidos de venda interna por UF (location e
// cliente contribuinte da UF, natureza VENDA), separados para a recusa do combustível não esconder o resto:
//   PIS  — PIS/COFINS monofásico (Leis 10.147, 10.485, 13.097, 9.718): medicamento, perfumaria, pneu, autopeça,
//          veículo, bebida fria, etanol;
//   COMB — ICMS monofásico de combustível (LC 192/2022): gasolina, diesel, GLP, biodiesel. O bundle não manda
//          cProdANP (D33), então o esperado hoje é a recusa.
// Retomável pelo memo "FP MONO <grupo> <UF>" (com " <rodada>" fora da r12). Saída <rodada>_ns_pedidos.jsonl; quem lê é
// d9_regua.js com o mesmo RODADA.
// Uso: [RODADA=r13] node f10_ns_monofasico.js [UF...]   (padrão r12)
const fs = require('fs'); const { call } = require('./ns.js');
const L = require('./locations_uf.json'), C = require('./clientes_uf.json');
const PAR = +(process.env.PAR || 2), NAT = process.env.NAT || '16', RODADA = process.env.RODADA || 'r12';
const LOG = RODADA + '_ns_pedidos.jsonl', SUF = RODADA === 'r12' ? '' : ' ' + RODADA;
const GRUPOS = {
  PIS: ['30049099', '33030010', '33049910', '33051000', '40111000', '87083090', '87032310', '22030000', '22021000', '22011000', '22071090'],
  COMB: ['27101259', '27101921', '27111910', '38260000'],
  GLP: ['27111910']
};
async function todos(q) {
  const out = []; for (let off = 0; ; off += 1000) {
    const r = JSON.parse((await call('POST', '/query/v1/suiteql?limit=1000&offset=' + off, { q })).body);
    out.push(...r.items); if (!r.hasMore) return out;
  }
}
(async () => {
  const NCMS = Object.values(GRUPOS).flat();
  const achados = await todos("select id, itemid from item where isinactive='F' and (" + NCMS.map(n => "itemid like 'FP-NCM-" + n + "%'").join(' or ') + ") order by itemid");
  const porNcm = {}; achados.forEach(x => { const n = x.itemid.slice(7, 15); if (!porNcm[n]) porNcm[n] = x.id; });
  const faltam = NCMS.filter(n => !porNcm[n]); if (faltam.length) console.log('sem item:', faltam.join(' '));
  const feitos = new Set((await todos("select memo from transaction where type='SalesOrd' and memo like 'FP MONO %'")).map(x => x.memo));
  const ufs = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(L).sort();
  // SO=COMB roda só esse grupo; UM=1 abre um pedido por NCM, porque a recusa é da nota inteira e
  // só nomeia a primeira linha.
  let grupos = process.env.SO ? { [process.env.SO]: GRUPOS[process.env.SO] } : GRUPOS;
  if (process.env.UM) grupos = Object.fromEntries(Object.entries(grupos).flatMap(([g, ns]) => ns.map(n => [g + '-' + n, [n]])));
  Object.assign(GRUPOS, grupos);
  const fila = ufs.flatMap(uf => Object.keys(grupos).map(g => ({ uf, g, memo: 'FP MONO ' + g + ' ' + uf + SUF }))).filter(p => !feitos.has(p.memo));
  console.log('a fazer', fila.length);
  let k = 0;
  await Promise.all(Array.from({ length: PAR }, async () => {
    while (k < fila.length) {
      const p = fila[k++]; const t0 = Date.now();
      const ids = GRUPOS[p.g].filter(n => porNcm[n]).map(n => porNcm[n]);
      const body = { entity: { id: C[p.uf] }, subsidiary: { id: '3' }, location: { id: L[p.uf] }, customForm: { id: '111' }, currency: { id: '5' },
        tranDate: new Date().toISOString().slice(0, 10), memo: p.memo, custbody_fp_natureza: { id: NAT },
        item: { items: ids.map(i => ({ item: { id: i }, quantity: 1, rate: 100, taxCode: { id: '5' } })) } };
      let r;
      for (let t = 0; t < 6; t++) {
        try { r = await call('POST', '/record/v1/salesOrder', body); } catch (e) { r = { code: 'EXC', body: e.message }; }
        if (r.code === 429 || r.code === 'EXC' || r.code >= 500) { await new Promise(s => setTimeout(s, 5000 * (t + 1))); continue; }
        break;
      }
      const id = r.loc ? r.loc.split('/').pop() : null;
      fs.appendFileSync(LOG, JSON.stringify({ uf: p.uf, grupo: p.g, memo: p.memo, linhas: ids.length, id, code: r.code, s: Math.round((Date.now() - t0) / 1000), erro: id ? undefined : String(r.body).slice(0, 400) }) + '\n');
      console.log(p.memo, r.code, id || String(r.body).slice(0, 200), Math.round((Date.now() - t0) / 1000) + 's');
    }
  }));
})();
