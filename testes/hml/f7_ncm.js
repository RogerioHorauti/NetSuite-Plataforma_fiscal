// Rodada 10 — todos os NCM: cada NCM do cadastro da plataforma (GET /fiscal/ncm-crud, varrido por prefixo)
// passa por /fiscal/simular em cada cenário, em lotes de LOTE linhas por nota. Lote recusado é dividido ao
// meio até isolar o NCM que derruba a nota. Cada linha passa por invariantes que não dependem de gabarito;
// o resto vira distribuição (CST × NCM) para o contador conferir.
// Uso: node f7_ncm.js [cenario...]   (sem argumento roda todos)   NCMS=arquivo.json reaproveita a lista.
const fs = require('fs');
const { call } = require('./fp_hml.js');
const LOTE = +(process.env.LOTE || 50);
const PAR = +(process.env.PAR || 3);
const END = { logradouro: 'Rua T', numero: '1', bairro: 'Centro', pais: '1058' };
const CP = {
  SP: Object.assign({ nome: 'Destino SP', cnpjCpf: '10882795000162', ie: '633685416111', indIe: 1, regimeTributario: 'LR', municipio: 'Santos', uf: 'SP', cep: '11015504' }, END),
  SC: Object.assign({ nome: 'Destino SC', cnpjCpf: '34564225000192', ie: '260196711', indIe: 1, regimeTributario: 'LR', municipio: 'Palhoça', uf: 'SC', cep: '88137280' }, END),
  CPF_RJ: Object.assign({ nome: 'Consumidor RJ', cnpjCpf: '39053344705', indIe: 9, regimeTributario: 'PF', municipio: 'Rio de Janeiro', uf: 'RJ', cep: '20010000' }, END),
  ES: Object.assign({ nome: 'Destino ES', cnpjCpf: '10664687000385', ie: '084073560', indIe: 1, regimeTributario: 'LR', municipio: 'Cariacica', uf: 'ES', cep: '29156777' }, END)
};
// [nome, empresa, natureza, contraparte, origem, aliquota ICMS interestadual esperada (null = interna)]
const CENARIOS = [
  ['gl_interna', '10664687000113', 'VENDA', CP.SP, '0', null],
  ['gl_sc', '10664687000113', 'VENDA', CP.SC, '0', 12],
  ['gl_sc_import', '10664687000113', 'VENDA', CP.SC, '1', 4],
  ['gl_cpf_rj', '10664687000113', 'VENDA', CP.CPF_RJ, '0', 12],
  ['b_simples_sp', '56103847000156', 'VENDA', CP.SP, '0', null],
  ['c_lr_es', '39267415000161', 'VENDA', CP.ES, '0', null],
  ['a_prod_sp', '47829163000145', 'VENDA_PROD', CP.SP, '0', null],
  ['gl_st_sp', '10664687000113', 'VENDA_ST', CP.SP, '0', null]
];
const SAIDA = n => (process.env.PREFIXO || 'r10_ncm_') + n;

async function listaNcm() {
  if (process.env.NCMS) return JSON.parse(fs.readFileSync(process.env.NCMS, 'utf8'));
  const todos = new Map();
  async function varre(p) {
    const r = await call('10664687000113', 'GET', '/fiscal/ncm-crud?q=' + p);
    if (r.code !== 200) throw new Error('lista NCM ' + p + ' HTTP ' + r.code);
    if (r.body.length >= 500) { for (let d = 0; d <= 9; d++) await varre(p + d); return; }
    r.body.filter(x => x.codigo.startsWith(p)).forEach(x => todos.set(x.codigo, x));
  }
  for (let c = 0; c <= 99; c++) await varre(String(c).padStart(2, '0'));
  return [...todos.values()];
}

const linha = (n, i, origem) => ({ numeroItem: i + 1, descricao: 'NCM ' + n.codigo, codigoProduto: 'N' + n.codigo, unidade: 'UN',
  ncm: n.codigo, cest: n.cest, origemProduto: origem, quantidade: 1, valorProduto: 100, valorBruto: 100, valorTotal: 100 });

async function simula(c, ncms) {
  const [, emp, nat, cp, origem] = c;
  const payload = { cnpjEmpresa: emp, naturezaOperacaoId: nat, dataEmissao: '2026-10-21', contraparte: cp,
    linhas: ncms.map((n, i) => linha(n, i, origem)) };
  for (let t = 0; ; t++) {
    let r; try { r = await call(emp, 'POST', '/fiscal/simular', payload); } catch (e) { r = { code: 'EXC', body: { message: e.message } }; }
    if ((r.code === 'EXC' || r.code === 429 || r.code === 403 || r.code >= 502) && t < 4) { await new Promise(s => setTimeout(s, 2000 * (t + 1))); continue; }
    return r;
  }
}

// Lote recusado: divide até isolar. Devolve [{ncm, r (linha da resposta) | erro}].
async function roda(c, ncms) {
  const r = await simula(c, ncms);
  if (r.code === 200 || r.code === 201) return ncms.map((n, i) => ({ n, l: r.body.linhas[i], ms: r.ms }));
  if (ncms.length === 1) {
    const msg = String((r.body && (r.body.message || r.body.mensagem)) || JSON.stringify(r.body));
    // NCM que abre em vários CEST: roda uma vez com cada candidato que a recusa lista (até 12).
    if (r.body && r.body.erro === 'CestAmbiguoParaONcmError' && !ncms[0].cest) {
      const cands = [...new Set([...msg.split('entre:')[1].matchAll(/([\d.]{7,9}) \(/g)].map(m => m[1].replace(/\D/g, '')))];
      let out = [];
      for (const cest of cands) out = out.concat(await roda(c, [Object.assign({}, ncms[0], { cest })]));
      return out;
    }
    return [{ n: ncms[0], erro: r.code + ' ' + (r.body && r.body.erro || '') + ' ' + msg.slice(0, 300) }];
  }
  const m = ncms.length >> 1;
  return (await roda(c, ncms.slice(0, m))).concat(await roda(c, ncms.slice(m)));
}

function confere(c, n, l) {
  const [, , , , origem, interAliq] = c;
  const achados = [];
  const t = cod => l.impostos.find(i => i.taxCodigo === cod);
  const icms = t('ICMS'), ipi = t('IPI'), pis = t('PIS'), cof = t('COFINS');
  const simples = c[0].startsWith('b_');
  if (!icms) achados.push('SEM_ICMS');
  else {
    const cst = icms.cst;
    if (['00', '10', '20', '70'].includes(cst) && !(icms.aliquota > 0)) achados.push('ICMS_CST' + cst + '_ALIQ0');
    if (['00', '10', '20', '70'].includes(cst) && !(icms.valor > 0)) achados.push('ICMS_CST' + cst + '_VALOR0');
    if (['40', '41', '50', '60'].includes(cst) && icms.valor > 0) achados.push('ICMS_CST' + cst + '_COM_VALOR');
    if (interAliq != null && ['00', '10', '20', '70', '90'].includes(cst) && icms.aliquota > 0 && icms.aliquota !== interAliq) achados.push('ICMS_INTER_' + icms.aliquota + '_ESPERADO_' + interAliq);
    if (simples && cst && cst.length === 2) achados.push('SIMPLES_COM_CST_' + cst);
  }
  for (const i of l.impostos) {
    if (!(i.valor >= 0) || !(i.baseCalculo >= 0) || i.valor > i.baseCalculo + 0.01 && i.taxCodigo !== 'ICMS_ST') achados.push('NUM_' + i.taxCodigo + '_' + i.valor + '/' + i.baseCalculo);
    if (i.aliquota > 0 && i.baseCalculo > 0 && Math.abs(i.baseCalculo * i.aliquota / 100 - i.valor) > 0.02 && !/ST|DIFAL|FCP/.test(i.taxCodigo)) achados.push('CONTA_' + i.taxCodigo);
  }
  if (ipi && ipi.valor > 0) {
    if (n.tipiSituacao === 'NT') achados.push('IPI_EM_NCM_NT');
    else if (n.aliquotaIpi != null && Math.abs(+n.aliquotaIpi - ipi.aliquota) > 0.001) achados.push('IPI_ALIQ_' + ipi.aliquota + '_TIPI_' + (+n.aliquotaIpi));
  }
  if (pis && cof && pis.cst !== cof.cst) achados.push('PIS_' + pis.cst + '_COFINS_' + cof.cst);
  if (!l.cfopCodigo) achados.push('SEM_CFOP');
  const st = t('ICMS_ST');
  if (icms && icms.cst === '10' && !(st && st.valor > 0)) achados.push('CST10_SEM_ST');
  if (/^[56]40[13]$/.test(l.cfopCodigo) && !(st && st.valor > 0)) achados.push('CFOP_' + l.cfopCodigo + '_SEM_ST_CST_' + (icms && icms.cst) + (n.cest ? '_COM_CEST' : ''));
  if (st && st.valor > 0 && icms && !['10', '30', '70', '201', '202', '203'].includes(icms.cst)) achados.push('ST_COM_CST_' + icms.cst);
  if (c[2] === 'VENDA_PROD' && n.tipiSituacao === 'TRIBUTADO' && +n.aliquotaIpi > 0 && !(ipi && ipi.valor > 0)) achados.push('IPI_FALTANDO_TIPI_' + (+n.aliquotaIpi));
  return achados;
}

(async () => {
  const ncms = await listaNcm();
  fs.writeFileSync(SAIDA('lista.json'), JSON.stringify(ncms));
  const quais = process.argv.slice(2);
  for (const c of CENARIOS.filter(c => !quais.length || quais.includes(c[0]))) {
    const ini = Date.now(), lotes = [];
    for (let i = 0; i < ncms.length; i += LOTE) lotes.push(ncms.slice(i, i + LOTE));
    const res = []; let k = 0;
    await Promise.all(Array.from({ length: PAR }, async () => {
      while (k < lotes.length) { const j = k++; res[j] = await roda(c, lotes[j]); }
    }));
    const linhas = res.flat().map(({ n, l, erro, ms }) => {
      if (erro) return { ncm: n.codigo, cest: n.cest, erro };
      const t = cod => l.impostos.find(i => i.taxCodigo === cod) || {};
      return { ncm: n.codigo, cest: n.cest, tipi: n.tipiSituacao, tipiAliq: n.aliquotaIpi, cfop: l.cfopCodigo,
        icms: [t('ICMS').cst, t('ICMS').aliquota, t('ICMS').valor].join('/'), st: t('ICMS_ST').valor || 0,
        ipi: [t('IPI').cst, t('IPI').aliquota, t('IPI').valor].join('/'),
        pis: [t('PIS').cst, t('PIS').aliquota].join('/'), cofins: [t('COFINS').cst, t('COFINS').aliquota].join('/'),
        cbs: [t('CBS').cst, t('CBS').cclasstrib].join('/'), difal: t('ICMS_DIFAL').valor || 0,
        outros: l.impostos.map(i => i.taxCodigo).filter(x => !/^(ICMS|ICMS_ST|IPI|PIS|COFINS|CBS|IBS_ESTADUAL|IBS_MUNICIPAL|ICMS_DIFAL)$/.test(x)).join(','),
        achados: confere(c, n, l) };
    });
    fs.writeFileSync(SAIDA(c[0] + '.json'), JSON.stringify(linhas));
    const conta = {}; linhas.forEach(x => (x.erro ? ['ERRO ' + x.erro.slice(0, 90)] : x.achados).forEach(a => conta[a] = (conta[a] || 0) + 1));
    const dist = {}; linhas.filter(x => !x.erro).forEach(x => { const k2 = 'ICMS ' + x.icms.split('/')[0] + ' | IPI ' + x.ipi.split('/')[0] + ' | PIS ' + x.pis.split('/')[0]; dist[k2] = (dist[k2] || 0) + 1; });
    console.log('== ' + c[0] + ': ' + linhas.length + ' NCM, ' + linhas.filter(x => x.erro).length + ' recusados, ' +
      linhas.filter(x => x.achados && x.achados.length).length + ' com achado, ' + Math.round((Date.now() - ini) / 1000) + ' s');
    Object.entries(conta).sort((a, b) => b[1] - a[1]).forEach(([a, q]) => console.log('  ' + q + '\t' + a));
    console.log('  distribuição:'); Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([a, q]) => console.log('    ' + q + '\t' + a));
  }
})();
