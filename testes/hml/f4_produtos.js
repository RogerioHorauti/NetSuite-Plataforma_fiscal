// Rodada 4 — produtos com regra própria (ST/CEST, monofásico, IPI alto, importado 4%), pelo
// /simular. Cada produto vai em VENDA (revenda) e VENDA_PROD (industrial), interna e para MG,
// contribuinte. Asserção: sem 5xx; o resto é LEITURA (tabela), o veredito vem da F2.
const fs = require('fs');
const { call } = require('./fp_hml.js');
const EMP = process.env.EMP || '10664687000113';

const PRODUTOS = [
  { id: 'cerveja-lata', ncm: '22030000', cest: '0302103', origem: '0' },
  { id: 'cerveja-sem-cest', ncm: '22030000', origem: '0' },
  { id: 'pneu-auto', ncm: '40111000', cest: '1600100', origem: '0' },
  { id: 'cosmetico', ncm: '33049990', cest: '2001600', origem: '0' },
  { id: 'medicamento', ncm: '30049099', origem: '0' },
  { id: 'autopeca', ncm: '87083090', origem: '0' },
  { id: 'gasolina', ncm: '27101259', cest: '0600201', origem: '0' },
  { id: 'cigarro', ncm: '24022000', origem: '0' },
  { id: 'smartphone', ncm: '85171300', cest: '2105300', origem: '0' },
  { id: 'notebook-importado', ncm: '84713012', origem: '1' },
  { id: 'movel-importado-cc', ncm: '94033000', origem: '2' },
  { id: 'movel-nacional-cont-imp-alto', ncm: '94033000', origem: '3' }
];
const PARTES = {
  SP: { nome: 'Cliente SP', cnpjCpf: '11222333000181', ie: '110042490114', indIe: 1, regimeTributario: 'LR', logradouro: 'Rua T', numero: '1', bairro: 'C', municipio: 'São Paulo', uf: 'SP', cep: '01001000', pais: '1058' },
  MG: { nome: 'Cliente MG', cnpjCpf: '22333444000181', ie: '0623079040081', indIe: 1, regimeTributario: 'LR', logradouro: 'Rua T', numero: '1', bairro: 'C', municipio: 'Belo Horizonte', uf: 'MG', cep: '30110000', pais: '1058' }
};

(async () => {
  const res = [];
  for (const p of PRODUTOS) for (const nat of ['VENDA', 'VENDA_PROD']) for (const uf of ['SP', 'MG']) {
    const l = { numeroItem: 1, valorProduto: 100, quantidade: 2, valorTotal: 200, valorBruto: 200, descricao: p.id, unidade: 'UN', codigoProduto: p.id, ncm: p.ncm, origemProduto: p.origem };
    if (p.cest) l.cest = p.cest;
    const payload = { cnpjEmpresa: EMP, naturezaOperacaoId: nat, dataEmissao: '2026-10-20', contraparte: PARTES[uf], linhas: [l] };
    let r; try { r = await call(EMP, 'POST', '/fiscal/simular', payload); } catch (e) { r = { code: 'EXC', body: e.message, ms: 0 }; }
    const l0 = r.code === 200 && r.body.linhas && r.body.linhas[0];
    const imps = l0 ? l0.impostos.map(t => t.taxCodigo.replace('IBS_ESTADUAL', 'IBSE').replace('IBS_MUNICIPAL', 'IBSM') + ':' + (t.cst || '-') + '@' + t.aliquota + '=' + t.valor) : [];
    const msg = r.code === 200 ? '' : String(typeof r.body === 'string' ? r.body : r.body.message || JSON.stringify(r.body)).slice(0, 260);
    const linhaOut = p.id.padEnd(28) + nat.padEnd(11) + uf + ' ' + r.code + ' ' + (l0 ? l0.cfopCodigo : '') + ' ' + (imps.join(' ') || msg);
    console.log(linhaOut);
    res.push({ produto: p, natureza: nat, uf, code: r.code, cfop: l0 && l0.cfopCodigo, impostos: imps, msg, avisos: r.body && r.body.avisos, payload, resposta: r.body });
  }
  fs.writeFileSync(process.env.SAIDA || 'r4_produtos.json', JSON.stringify(res, null, 1));
})();
