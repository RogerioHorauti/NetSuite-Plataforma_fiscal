// Analisa a rodada 10 pelo NetSuite: para cada pedido de r10_ns_pedidos.jsonl, lê no File Cabinet o
// FP-salesorder-<id>-payload.json e o -retorno.json (SOAP get, cache em r10_ns_cache/) e confere:
//  · BUNDLE — cnpjEmpresa é a filial da UF, contraparte é da UF, uma linha de payload por item com o NCM/CEST
//    do cadastro do item, uma linha de retorno por linha de payload;
//  · MOTOR  — invariantes que não dependem de gabarito (CST × valor, conta base × alíquota, PIS = COFINS,
//    IPI × TIPI, CST 10 sem ST), e a distribuição de ICMS por UF para o contador conferir.
// Uso: node a8_ns_ncm.js            → r10_ns_analise.json + resumo no console
const fs = require('fs'); const { call } = require('./ns.js'); const { getFile } = require('./ns_file.js');
const F = require('./filiais_uf.json');
const UF_CLI = Object.fromEntries(Object.entries(require('./clientes_uf.json')).map(([uf, id]) => [id, uf]));
const CACHE = 'r10_ns_cache'; if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE);
const TIPI = Object.fromEntries(require('./r10_ncm_lista.json').map(n => [n.codigo.replace(/\D/g, ''), n]));

async function sql(q) {
  const out = []; for (let off = 0; ; off += 1000) {
    let r; for (let t = 0; t < 6; t++) { r = await call('POST', '/query/v1/suiteql?limit=1000&offset=' + off, { q }); if (r.code !== 429) break; await new Promise(s => setTimeout(s, 4000)); }
    const j = JSON.parse(r.body); if (!j.items) throw new Error('SuiteQL ' + r.code + ' ' + r.body.slice(0, 200));
    out.push(...j.items); if (!j.hasMore) return out;
  }
}
async function arquivo(id, nome) {
  const c = CACHE + '/' + nome; if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, 'utf8'));
  let t; for (let k = 0; k < 6; k++) { try { t = await getFile(id); break; } catch (e) { if (k === 5) throw e; await new Promise(s => setTimeout(s, 4000)); } }
  fs.writeFileSync(c, t); return JSON.parse(t);
}

function confereMotor(l) {
  const a = []; const t = c => l.impostos.find(i => i.taxCodigo === c);
  const icms = t('ICMS'), ipi = t('IPI'), pis = t('PIS'), cof = t('COFINS'), st = t('ICMS_ST');
  if (!icms) a.push('SEM_ICMS');
  else {
    if (['00', '10', '20', '70'].includes(icms.cst) && !(icms.valor > 0)) a.push('ICMS_CST' + icms.cst + '_VALOR0');
    if (['40', '41', '50', '60'].includes(icms.cst) && icms.valor > 0) a.push('ICMS_CST' + icms.cst + '_COM_VALOR');
    if (icms.cst === '10' && !(st && st.valor > 0)) a.push('CST10_SEM_ST');
  }
  for (const i of l.impostos) {
    if (!(i.valor >= 0) || !(i.baseCalculo >= 0)) a.push('NUM_' + i.taxCodigo);
    if (i.aliquota > 0 && i.baseCalculo > 0 && Math.abs(i.baseCalculo * i.aliquota / 100 - i.valor) > 0.02 && !/ST|DIFAL|FCP/.test(i.taxCodigo)) a.push('CONTA_' + i.taxCodigo);
  }
  const n = TIPI[String(l.ncm || '').replace(/\D/g, '')];
  if (ipi && ipi.valor > 0 && n && n.tipiSituacao === 'NT') a.push('IPI_EM_NCM_NT');
  if (pis && cof && pis.cst !== cof.cst) a.push('PIS_' + pis.cst + '_COFINS_' + cof.cst);
  if (!l.cfopCodigo) a.push('SEM_CFOP');
  return a;
}

(async () => {
  const pedidos = fs.readFileSync(process.env.PEDIDOS || 'r10_ns_pedidos.jsonl', 'utf8').trim().split('\n').map(JSON.parse).filter(p => p.id);
  const ids = pedidos.map(p => p.id);
  // Arquivos e itens de todos os pedidos de uma vez (lista: junta ids, busca uma vez, preenche).
  const arqs = {}, linhasNs = {};
  for (let i = 0; i < ids.length; i += 200) {
    const fatia = ids.slice(i, i + 200);
    for (const f of await sql("select id, name from file where name in (" + fatia.flatMap(id => ["'FP-salesorder-" + id + "-payload.json'", "'FP-salesorder-" + id + "-retorno.json'"]).join(',') + ")")) arqs[f.name] = f.id;
    for (const r of await sql("select tl.transaction t, tl.linesequencenumber s, i.itemid, i.custitem_fp_ncm ncm, i.custitem_fp_cest cest from transactionline tl join item i on i.id = tl.item where tl.mainline='F' and i.itemid like 'FP-NCM-%' and tl.transaction in (" + fatia.join(',') + ")"))
      (linhasNs[r.t] = linhasNs[r.t] || []).push(r);
  }
  const porUf = {}, achados = {}, bundle = [], recusas = [];
  for (const p of pedidos) {
    const U = porUf[p.uf] = porUf[p.uf] || { pedidos: 0, linhas: 0, recusados: 0, dist: {} };
    U.pedidos++;
    const nP = 'FP-salesorder-' + p.id + '-payload.json', nR = 'FP-salesorder-' + p.id + '-retorno.json';
    if (!arqs[nP]) { bundle.push({ memo: p.memo, id: p.id, falha: 'SEM_PAYLOAD_GRAVADO' }); continue; }
    const pay = await arquivo(arqs[nP], nP);
    const ret = arqs[nR] ? await arquivo(arqs[nR], nR) : null;
    const ns = (linhasNs[p.id] || []).sort((a, b) => a.s - b.s);
    // BUNDLE
    if (pay.cnpjEmpresa !== F[p.uf].cnpj) bundle.push({ memo: p.memo, falha: 'CNPJ_EMPRESA ' + pay.cnpjEmpresa + ' ≠ filial ' + F[p.uf].cnpj });
    if (!pay.contraparte || pay.contraparte.uf !== p.uf) bundle.push({ memo: p.memo, falha: 'CONTRAPARTE_UF ' + (pay.contraparte && pay.contraparte.uf) });
    if (pay.linhas.length !== ns.length) bundle.push({ memo: p.memo, falha: 'LINHAS payload ' + pay.linhas.length + ' ≠ pedido ' + ns.length });
    pay.linhas.forEach((l, i) => {
      const it = ns[i]; if (!it) return;
      if (l.codigoProduto !== it.itemid) bundle.push({ memo: p.memo, falha: 'ORDEM linha ' + (i + 1) + ' ' + l.codigoProduto + ' ≠ ' + it.itemid });
      if (String(l.ncm || '') !== String(it.ncm || '').replace(/\D/g, '')) bundle.push({ memo: p.memo, item: it.itemid, falha: 'NCM payload ' + l.ncm + ' ≠ item ' + it.ncm });
      if (String(l.cest || '') !== String(it.cest || '').replace(/\D/g, '')) bundle.push({ memo: p.memo, item: it.itemid, falha: 'CEST payload ' + l.cest + ' ≠ item ' + it.cest });
    });
    if (!ret) { bundle.push({ memo: p.memo, falha: 'SEM_RETORNO_GRAVADO' }); continue; }
    const corpo = ret.body || ret;
    if (!corpo.linhas) { U.recusados++; recusas.push({ uf: p.uf, memo: p.memo, msg: String(corpo.message || JSON.stringify(corpo)).slice(0, 400) }); continue; }
    if (corpo.linhas.length !== pay.linhas.length) bundle.push({ memo: p.memo, falha: 'RETORNO ' + corpo.linhas.length + ' linhas ≠ payload ' + pay.linhas.length });
    // MOTOR
    corpo.linhas.forEach((l, i) => {
      U.linhas++;
      const icms = l.impostos.find(x => x.taxCodigo === 'ICMS') || {};
      const k = l.cfopCodigo + ' ICMS ' + icms.cst + '@' + icms.aliquota; U.dist[k] = (U.dist[k] || 0) + 1;
      for (const a of confereMotor(l)) (achados[p.uf + ' ' + a] = achados[p.uf + ' ' + a] || []).push((pay.linhas[i] || {}).codigoProduto);
    });
  }
  fs.writeFileSync(process.env.SAIDA || 'r10_ns_analise.json', JSON.stringify({ porUf, achados, bundle, recusas }, null, 1));
  console.log('pedidos', pedidos.length, '| falhas do bundle', bundle.length, '| pedidos recusados pelo motor', recusas.length);
  bundle.slice(0, 20).forEach(b => console.log('  BUNDLE', JSON.stringify(b)));
  recusas.slice(0, 10).forEach(r => console.log('  RECUSA', r.uf, r.memo, r.msg.slice(0, 160)));
  for (const [uf, U] of Object.entries(porUf).sort()) {
    console.log(uf, U.pedidos + ' pedidos', U.linhas + ' linhas', U.recusados + ' recusados', '|', Object.entries(U.dist).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, q]) => q + '× ' + k).join(' · '));
  }
  Object.entries(achados).sort((a, b) => b[1].length - a[1].length).forEach(([a, l]) => console.log('  ACHADO', l.length, a, l.slice(0, 3).join(' ')));
})();
