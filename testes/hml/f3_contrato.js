// F3 — contrato e robustez do /simular (e idempotência do /emitir). Asserção de contrato:
// payload inválido → 4xx com mensagem, NUNCA 5xx; válido grande → 200; concorrência sem erro.
const fs = require('fs');
const { call } = require('./fp_hml.js');
const EMP = process.env.EMP || '10664687000113';

const contraparte = { nome: 'Contraparte SP', cnpjCpf: '11222333000181', ie: '110042490114', indIe: 1, regimeTributario: 'LR',
  logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: 'São Paulo', uf: 'SP', cep: '01001000', pais: '1058' };
const linha = (i, extra) => Object.assign({ numeroItem: i, valorProduto: 100, quantidade: 2, valorTotal: 200, valorBruto: 200,
  descricao: 'Item ' + i, unidade: 'UN', codigoProduto: 'T-' + i, ncm: '85176272', cest: '2111000', origemProduto: '0' }, extra || {});
const base = () => ({ cnpjEmpresa: EMP, naturezaOperacaoId: 'VENDA', dataEmissao: '2026-10-20', contraparte: Object.assign({}, contraparte), linhas: [linha(1)] });
const com = (f) => { const p = base(); f(p); return p; };

// [nome, payload, esperado: 'ok' | '4xx']
const CASOS = [
  ['válido mínimo', base(), 'ok'],
  ['sem linhas', com(p => delete p.linhas), '4xx'],
  ['linhas vazias', com(p => { p.linhas = []; }), '4xx'],
  ['sem cnpjEmpresa', com(p => delete p.cnpjEmpresa), '4xx'],
  ['cnpjEmpresa de outra empresa', com(p => { p.cnpjEmpresa = '47829163000145'; }), '4xx'],
  ['cnpjEmpresa com máscara', com(p => { p.cnpjEmpresa = '10.664.687/0001-13'; }), 'ok'],
  ['cnpjEmpresa DV inválido', com(p => { p.cnpjEmpresa = '10664687000199'; }), '4xx'],
  ['natureza inexistente', com(p => { p.naturezaOperacaoId = 'NAO_EXISTE'; }), '4xx'],
  ['sem natureza', com(p => delete p.naturezaOperacaoId), '4xx'],
  ['data inválida', com(p => { p.dataEmissao = '2026-13-45'; }), '4xx'],
  ['sem contraparte', com(p => delete p.contraparte), '4xx'],
  ['contraparte UF inexistente', com(p => { p.contraparte.uf = 'XX'; }), '4xx'],
  ['contraparte CNPJ DV inválido', com(p => { p.contraparte.cnpjCpf = '11222333000199'; }), '4xx'],
  ['NCM inexistente', com(p => { p.linhas[0].ncm = '99999999'; delete p.linhas[0].cest; }), '4xx'],
  ['NCM com 7 dígitos', com(p => { p.linhas[0].ncm = '8517627'; }), '4xx'],
  ['quantidade zero', com(p => { p.linhas[0].quantidade = 0; }), '4xx'],
  ['valor negativo', com(p => { p.linhas[0].valorProduto = -10; p.linhas[0].valorTotal = -20; p.linhas[0].valorBruto = -20; }), '4xx'],
  ['valor como string', com(p => { p.linhas[0].valorProduto = '100'; }), 'ok'],
  ['valor com 4 casas', com(p => { p.linhas[0].valorProduto = 33.3333; p.linhas[0].quantidade = 3; p.linhas[0].valorTotal = 100; p.linhas[0].valorBruto = 100; }), 'ok'],
  ['total ≠ preço × qtd', com(p => { p.linhas[0].valorTotal = 999; p.linhas[0].valorBruto = 999; }), '4xx'],
  ['campo desconhecido', com(p => { p.campoQueNaoExiste = 1; p.linhas[0].outroCampo = 'x'; }), 'ok'],
  ['numeroItem repetido', com(p => { p.linhas.push(linha(1)); }), '4xx'],
  ['corpo vazio', {}, '4xx'],
  ['100 linhas', com(p => { p.linhas = Array.from({ length: 100 }, (_, i) => linha(i + 1)); }), 'ok'],
  ['990 linhas (limite NF-e)', com(p => { p.linhas = Array.from({ length: 990 }, (_, i) => linha(i + 1)); }), 'ok'],
  ['991 linhas (acima do nItem 990)', com(p => { p.linhas = Array.from({ length: 991 }, (_, i) => linha(i + 1)); }), '4xx'],
  ['desconto maior que o valor', com(p => { p.linhas[0].valorDesconto = 500; }), '4xx'],
  ['frete, seguro e outras', com(p => { Object.assign(p.linhas[0], { valorFrete: 10, valorSeguro: 5, valorOutras: 2.5 }); }), 'ok']
];

(async () => {
  const res = [];
  for (const [nome, payload, esperado] of CASOS) {
    let r; try { r = await call(EMP, 'POST', '/fiscal/simular', payload); } catch (e) { r = { code: 'EXC', body: e.message, ms: 0 }; }
    const classe = r.code >= 200 && r.code < 300 ? 'ok' : r.code >= 400 && r.code < 500 ? '4xx' : String(r.code);
    const msg = classe === 'ok' ? '' : String(typeof r.body === 'string' ? r.body : (Array.isArray(r.body.message) ? r.body.message.join('; ') : r.body.message || JSON.stringify(r.body))).slice(0, 300);
    const extra = classe === 'ok' && r.body && r.body.linhas ? ' linhas=' + r.body.linhas.length + ' totalNf=' + r.body.totalNf : '';
    res.push({ nome, esperado, code: r.code, ms: r.ms, passou: classe === esperado, msg, extra });
    console.log((classe === esperado ? 'OK  ' : 'FAIL') + ' ' + nome.padEnd(34) + ' HTTP ' + r.code + ' ' + r.ms + 'ms ' + extra + ' ' + msg);
  }

  // CONCORRÊNCIA: 30 simulações iguais em paralelo — todas 200 e com o mesmo totalNf.
  const t0 = Date.now();
  const par = await Promise.all(Array.from({ length: 30 }, () => call(EMP, 'POST', '/fiscal/simular', base()).catch(e => ({ code: 'EXC', body: e.message }))));
  const codes = {}; for (const r of par) codes[r.code] = (codes[r.code] || 0) + 1;
  const totais = new Set(par.filter(r => r.code === 200).map(r => r.body.totalNf + '|' + JSON.stringify(r.body.linhas[0].impostos.map(i => i.valor))));
  const ms = par.map(r => r.ms || 0).sort((a, b) => a - b);
  console.log('CONCORRÊNCIA 30: ' + JSON.stringify(codes) + ' resultados distintos=' + totais.size + ' p50=' + ms[15] + ' p95=' + ms[28] + ' total=' + (Date.now() - t0) + 'ms');
  res.push({ nome: 'concorrência 30', codes, distintos: totais.size, p50: ms[15], p95: ms[28] });

  fs.writeFileSync(process.env.SAIDA || 'f3_resultado.json', JSON.stringify(res, null, 1));
})();
