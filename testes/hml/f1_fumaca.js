// F1 — fumaça por natureza × âmbito, contra o /simular do hml. Asserções de consistência
// interna (não é gabarito normativo): HTTP 200, CFOP = o da natureza no âmbito, imposto com CST.
const fs = require('fs');
const { call } = require('./fp_hml.js');
const EMP = process.env.EMP || '10664687000113';

function cnpj(base12) {
  const d = base12.split('').map(Number);
  const dv = (arr, pesos) => { const s = arr.reduce((a, n, i) => a + n * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  d.push(dv(d, p1)); d.push(dv(d, p2));
  return d.join('');
}

// Contrapartes por UF. UF_EMP (default SP) decide a interna; a interestadual é MG (ou SP se o
// emitente for de MG). CP escolhe o tipo: CONTRIB (default), NAOCONTRIB, CF (consumidor final, CPF).
const UF_EMP = process.env.UF_EMP || 'SP';
const CP = process.env.CP || 'CONTRIB';
const LOCAIS = {
  SP: { municipio: 'São Paulo', cep: '01001000', ie: '110042490114', base: '112223330001' },
  MG: { municipio: 'Belo Horizonte', cep: '30110000', ie: '0623079040081', base: '223334440001' },
  ES: { municipio: 'Vitória', cep: '29010000', ie: '082560480', base: '334445550001' }
};
function parte(uf) {
  const l = LOCAIS[uf];
  const p = { nome: 'Contraparte ' + uf + ' ' + CP, logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: l.municipio, uf, cep: l.cep, pais: '1058' };
  if (CP === 'CF') Object.assign(p, { cnpjCpf: '39053344705', indIe: 9, regimeTributario: 'PF' });
  else if (CP === 'NAOCONTRIB') Object.assign(p, { cnpjCpf: cnpj(l.base.slice(0, 8) + '0002'), indIe: 9, regimeTributario: 'LP' });
  else Object.assign(p, { cnpjCpf: cnpj(l.base), ie: l.ie, indIe: 1, regimeTributario: 'LR' });
  return p;
}
const PARTES = {
  INTERNA: parte(UF_EMP),
  INTERESTADUAL: parte(UF_EMP === 'MG' ? 'SP' : 'MG'),
  EXTERIOR: { nome: 'Counterparty US', indIe: 9, logradouro: 'Main St', numero: '1', bairro: 'Downtown',
    municipio: 'EXTERIOR', uf: 'EX', cep: '00000000', pais: '2496' }
};
const SAIDA = process.env.SAIDA || 'f1_resultado.json';

function linha(servico) {
  const l = { numeroItem: 1, valorProduto: 100, quantidade: 2, valorTotal: 200, valorBruto: 200, descricao: 'Item de teste', unidade: 'UN', codigoProduto: 'TESTE-1' };
  if (servico) l.codigoServicoLc116 = '1.07';
  else { l.ncm = '85176272'; l.cest = '2111000'; l.origemProduto = '0'; }
  return l;
}

(async () => {
  const nat = await call(EMP, 'GET', '/natureza-operacao?limit=500');
  const naturezas = nat.body;
  fs.writeFileSync('naturezas_hml.json', JSON.stringify(naturezas));
  const casos = [];
  for (const n of naturezas) {
    const amb = { INTERNA: n.cfopInternoCodigo, INTERESTADUAL: n.cfopInterestadualCodigo, EXTERIOR: n.cfopExteriorCodigo };
    const algum = Object.values(amb).some(Boolean);
    for (const [a, cfop] of Object.entries(amb)) if (cfop || (!algum && a === 'INTERNA')) casos.push({ n, a, cfop: cfop || null });
  }
  console.log('naturezas', naturezas.length, 'casos', casos.length);
  const res = [];
  for (const c of casos) {
    const servico = /SERV/.test(c.n.codigo);
    const payload = { cnpjEmpresa: EMP, naturezaOperacaoId: c.n.codigo, dataEmissao: '2026-10-20', contraparte: PARTES[c.a], linhas: [linha(servico)] };
    let r;
    try { r = await call(EMP, 'POST', '/fiscal/simular', payload); } catch (e) { r = { code: 'EXC', body: e.message, ms: 0 }; }
    const l0 = r.body && r.body.linhas && r.body.linhas[0];
    const cfopDev = l0 && (l0.cfopCodigo || l0.cfop) || null;
    const imps = (l0 && l0.impostos) || [];
    const falhas = [];
    if (r.code !== 200) falhas.push('HTTP ' + r.code);
    else {
      // Venda a não contribuinte: 6101→6107 e 6102→6108 é a derivação certa (tabela CFOP), não divergência.
      const NC = { '6101': '6107', '6102': '6108' };
      const aceito = CP !== 'CONTRIB' && NC[c.cfop] === cfopDev;
      if (c.cfop && cfopDev !== c.cfop && !aceito) falhas.push('CFOP ' + cfopDev + ' ≠ ' + c.cfop);
      if (!c.cfop) falhas.push('natureza sem CFOP no catálogo; motor devolveu ' + cfopDev);
      for (const t of imps) if (t.taxCodigo !== 'II' && t.taxCodigo !== 'ISS' && t.taxCodigo !== 'ICMS_DIFAL' && !t.cst && t.cst !== '0') falhas.push(t.taxCodigo + ' sem CST');
    }
    const msg = r.code === 200 ? '' : (typeof r.body === 'string' ? r.body : (r.body.message || r.body.erro || JSON.stringify(r.body))).toString().slice(0, 400);
    res.push({ natureza: c.n.codigo, es: c.n.entradaSaida, ambito: c.a, cfopEsperado: c.cfop, cfopDevolvido: cfopDev, code: r.code, ms: r.ms,
      impostos: imps.map(t => t.taxCodigo + ':' + t.cst + (t.cclasstrib ? '/' + t.cclasstrib : '') + '=' + t.valor), falhas, msg, payload, resposta: r.body });
    process.stdout.write(falhas.length ? 'x' : '.');
  }
  fs.writeFileSync(SAIDA, JSON.stringify(res, null, 1));
  const ok = res.filter(r => !r.falhas.length).length;
  console.log('\nok', ok, '/', res.length);
})();
