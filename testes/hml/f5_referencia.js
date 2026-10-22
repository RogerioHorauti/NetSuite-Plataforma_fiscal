// Rodada 5 — devolução e complemento contra as seis vendas AUTORIZADAS em homologação capturadas
// na GL (Downloads/xml-hml-devolucao/LEIA-ME.md). Devolução parcial manda numeroLinhaReferencia
// (nItem da origem) por linha; complemento usa o destinatário da nota original.
// Cada caso diz o que espera: 'ok' (com CFOP) ou '4xx' (recusa com causa). Valores são leitura.
const fs = require('fs');
const { call } = require('./fp_hml.js');
const EMP = '10664687000113';

const N = {
  V5101: '35260910664687000113550020000001741936091636',
  V5102: '35260810664687000113550020000001331119875801',
  V5401: '35260710664687000113550020000000811023947591',
  V6101: '35260910664687000113550020000001781119013449',
  V6102: '35260810664687000113550020000001341645430770',
  V6401: '35260710664687000113550020000000861150111448',
  V6102_ICMS: '35260910664687000113550020000001701500137044',
  V5102_ST: '35260810664687000113550020000001291387404810',
  RASCUNHO: '35261010664687000113550020000000011334253385'
};
N.DV_RUIM = N.V5102.slice(0, 43) + ((+N.V5102[43] + 1) % 10);

// Destinatários das notas de origem: a contraparte da devolução e do complemento.
const END = { logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', pais: '1058' };
const CP = {
  CPF_SP: Object.assign({ nome: 'Consumidor SP', cnpjCpf: '11122233396', indIe: 9, regimeTributario: 'PF', municipio: 'São Paulo', uf: 'SP', cep: '01001000' }, END),
  C5102: Object.assign({ nome: 'Destino 5102', cnpjCpf: '11223344002634', indIe: 9, regimeTributario: 'LP', municipio: 'São Paulo', uf: 'SP', cep: '01001000' }, END),
  C5401: Object.assign({ nome: 'Destino 5401', cnpjCpf: '10882795000162', ie: '633685416111', indIe: 1, regimeTributario: 'LR', municipio: 'Santos', uf: 'SP', cep: '11015504' }, END),
  ES: Object.assign({ nome: 'GL ES', cnpjCpf: '10664687000385', ie: '084073560', indIe: 1, regimeTributario: 'LR', municipio: 'Cariacica', uf: 'ES', cep: '29156777' }, END),
  SC: Object.assign({ nome: 'Destino 6102 SC', cnpjCpf: '34564225000192', ie: '260196711', indIe: 1, regimeTributario: 'LR', municipio: 'Palhoça', uf: 'SC', cep: '88137280' }, END),
  OUTRO: Object.assign({ nome: 'Outro SP', cnpjCpf: '11222333000181', ie: '110042490114', indIe: 1, regimeTributario: 'LR', municipio: 'São Paulo', uf: 'SP', cep: '01001000' }, END)
};

const ref = (chave, item, qtd) => { const l = { chaveAcessoReferencia: chave, numeroLinhaReferencia: item, descricao: 'Devolução item ' + item }; if (qtd != null) l.quantidade = qtd; return l; };
const semItem = (chave, qtd) => ({ chaveAcessoReferencia: chave, quantidade: qtd, descricao: 'Devolução' });
// Complemento de IMPOSTO (21f2c0ba): o ERP manda só a referência com valorProduto 0; a plataforma calcula a diferença.
const complImp = (chave) => ({ chaveAcessoReferencia: chave, numeroLinhaReferencia: 1, valorProduto: 0, quantidade: 1, valorTotal: 0, valorBruto: 0, descricao: 'Complemento de imposto', unidade: 'UN' });
const compl = (chave, v) => ({ chaveAcessoReferencia: chave, numeroLinhaReferencia: 1, valorProduto: v, quantidade: 1, valorTotal: v, valorBruto: v, descricao: 'Complemento', unidade: 'UN' });

// [nome, natureza, contraparte, linhas, esperado, CFOP esperado, o que conferir]
const CASOS = [
  ['5101 total', 'DEVOL_VENDA_PROD', CP.CPF_SP, [ref(N.V5101, 1)], 'ok', '1201', 'totalNf 250'],
  ['5102 total', 'DEVOL_VENDA', CP.C5102, [ref(N.V5102, 1)], 'ok', '1202', 'totalNf 103,25 (IPI 3,25)'],
  ['5401 parcial 3 de 10', 'DEVOL_VENDA_ST_PROD', CP.C5401, [ref(N.V5401, 1, 3)], 'ok', '1410', '30%: vProd 300, ICMS 54, ST 34,18, IPI 45'],
  ['5401 10 de 10', 'DEVOL_VENDA_ST_PROD', CP.C5401, [ref(N.V5401, 1, 10)], 'ok', '1410', 'D24: nota inteira, totalNf 1263,94 com IPI 150'],
  ['5401 11 de 10', 'DEVOL_VENDA_ST_PROD', CP.C5401, [ref(N.V5401, 1, 11)], '4xx', null, 'acima do vendido'],
  ['5401 quantidade sem item', 'DEVOL_VENDA_ST_PROD', CP.C5401, [semItem(N.V5401, 3)], '4xx', null, 'sem numeroLinhaReferencia'],
  ['5401 item 2 inexistente', 'DEVOL_VENDA_ST_PROD', CP.C5401, [ref(N.V5401, 2, 1)], '4xx', null, 'nItem não existe na origem'],
  ['6101 total', 'DEVOL_VENDA_PROD', CP.ES, [ref(N.V6101, 1)], 'ok', '2201', 'ICMS 4% = 40'],
  ['6102 total', 'DEVOL_VENDA', CP.ES, [ref(N.V6102, 1)], 'ok', '2202', 'totalNf 516,25'],
  ['6401 parcial por item', 'DEVOL_VENDA_ST_PROD', CP.ES, [ref(N.V6401, 1, 4), ref(N.V6401, 3, 2)], 'ok', '2410', 'item1 4/10 (ICMS 17,28, IPI 64,80) + item3 2/2 (ICMS 14, IPI 30)'],
  ['6401 item 2: 6 de 5', 'DEVOL_VENDA_ST_PROD', CP.ES, [ref(N.V6401, 2, 6)], '4xx', null, 'acima do vendido no item'],
  ['6401 item 4 inexistente', 'DEVOL_VENDA_ST_PROD', CP.ES, [ref(N.V6401, 4, 1)], '4xx', null, 'nItem não existe'],
  ['devolução de nota RASCUNHO', 'DEVOL_VENDA_PROD', CP.OUTRO, [ref(N.RASCUNHO, 1)], '4xx', null, 'D20: não autorizada (267)'],
  ['devolução com DV ruim', 'DEVOL_VENDA', CP.C5102, [ref(N.DV_RUIM, 1)], '4xx', null, 'C11: chave inválida (547)'],
  ['devolução de compra referenciando saída', 'DEVOL_COMPRA', CP.C5102, [ref(N.V5102, 1)], '4xx', null, 'origem não é entrada'],
  ['COMPL_PRECO 5102', 'COMPL_PRECO', CP.C5102, [compl(N.V5102, 10)], 'ok', '5102', 'D21: CFOP herdado'],
  ['COMPL_ICMS 5102 (origem ICMS 0%)', 'COMPL_ICMS', CP.C5102, [complImp(N.V5102)], 'ok', '5102', 'D22: diferença = devido pela régua − 0 destacado'],
  ['COMPL_IPI 5102 (origem IPI 3,25%)', 'COMPL_IPI', CP.C5102, [complImp(N.V5102)], 'ok', '5102', 'diferença de IPI se a TIPI for maior que 3,25%; sem ICMS (não contribuinte: com ICMS)'],
  ['COMPL_PRECO 6102', 'COMPL_PRECO', CP.ES, [compl(N.V6102, 10)], 'ok', '6102', 'CFOP herdado, interestadual'],
  ['6102 ICMS 12%: parcial 5 de 25', 'DEVOL_VENDA', CP.SC, [ref(N.V6102_ICMS, 1, 5)], 'ok', '2202', '20%: vProd 1028,73, ICMS 123,45'],
  ['5102 ST+IPI total por DEVOL_VENDA', 'DEVOL_VENDA', CP.C5401, [ref(N.V5102_ST, 1)], '4xx', null, 'D26: origem com ST pede natureza de ST'],
  ['5102 ST+IPI total como DEVOL_VENDA_ST', 'DEVOL_VENDA_ST', CP.C5401, [ref(N.V5102_ST, 1)], 'ok', '1411', 'D24: totalNf 631,97 = 500 + ST 56,97 + IPI 75'],
  ['5102 ST+IPI parcial 1 de 2', 'DEVOL_VENDA_ST', CP.C5401, [ref(N.V5102_ST, 1, 1)], 'ok', '1411', 'metade: ICMS 45, ST 28,49, IPI 37,50'],
  ['COMPL_ICMS 6102 (ICMS 12% correto)', 'COMPL_ICMS', CP.SC, [complImp(N.V6102_ICMS)], '4xx', null, 'diferença 0: recusa com causa'],
  ['COMPL_PRECO 6102 (ICMS 12%)', 'COMPL_PRECO', CP.SC, [compl(N.V6102_ICMS, 10)], 'ok', '6102', 'ICMS 12% sobre 10 = 1,20'],
  ['COMPL_IPI 5102 (ST, IPI 15% correto)', 'COMPL_IPI', CP.C5401, [complImp(N.V5102_ST)], '4xx', null, 'diferença 0: recusa com causa'],
  ['COMPL_PRECO 5102 (ST, IPI 15%)', 'COMPL_PRECO', CP.C5401, [compl(N.V5102_ST, 10)], 'ok', '5102', 'ICMS 18%, ST e IPI 15% sobre 10'],
  ['COMPL_PRECO outro destinatário', 'COMPL_PRECO', CP.OUTRO, [compl(N.V5102, 10)], '4xx', null, 'outra operação'],
  ['COMPL_PRECO de nota RASCUNHO', 'COMPL_PRECO', CP.OUTRO, [compl(N.RASCUNHO, 10)], '4xx', null, 'D20'],
  ['COMPL_PRECO com DV ruim', 'COMPL_PRECO', CP.C5102, [compl(N.DV_RUIM, 10)], '4xx', null, 'C11']
];

(async () => {
  const res = [];
  for (const [nome, nat, cp, linhas, esperado, cfopEsp, conferir] of CASOS) {
    linhas.forEach((l, i) => { l.numeroItem = i + 1; });
    const payload = { cnpjEmpresa: EMP, naturezaOperacaoId: nat, dataEmissao: '2026-10-21', contraparte: cp, linhas };
    let r; try { r = await call(EMP, 'POST', '/fiscal/simular', payload); } catch (e) { r = { code: 'EXC', body: e.message }; }
    const classe = r.code >= 200 && r.code < 300 ? 'ok' : r.code >= 400 && r.code < 500 ? '4xx' : String(r.code);
    const ls = (classe === 'ok' && r.body.linhas) || [];
    const cfops = [...new Set(ls.map(l => l.cfopCodigo))].join(',');
    const imps = ls.map(l => l.impostos.map(t => t.taxCodigo.replace('IBS_ESTADUAL', 'IBSE').replace('IBS_MUNICIPAL', 'IBSM') + ':' + (t.cst || '-') + '=' + t.valor).join(' ')).join(' || ');
    const qtds = ls.map(l => (l.quantidade ?? l.quantidadeComercial) + '×' + (l.valorTotal ?? l.valorBruto)).join(' + ');
    const msg = classe === 'ok' ? '' : String(typeof r.body === 'string' ? r.body : r.body.message || JSON.stringify(r.body)).slice(0, 260);
    const falhas = [];
    if (classe !== esperado) falhas.push('esperado ' + esperado + ', veio ' + r.code);
    if (classe === 'ok' && cfopEsp && cfops !== cfopEsp) falhas.push('CFOP ' + (cfops || 'null') + ' ≠ ' + cfopEsp);
    console.log((falhas.length ? 'FAIL' : 'OK  ') + ' ' + nome.padEnd(40) + r.code + ' ' + cfops + ' tot=' + (r.body && r.body.totalNf) + ' [' + qtds + '] ' + (imps || msg) + (falhas.length ? '  << ' + falhas.join('; ') : ''));
    res.push({ nome, natureza: nat, esperado, conferir, code: r.code, cfop: cfops, totalNf: r.body && r.body.totalNf, qtds, imps, msg, falhas, payload, resposta: r.body });
  }
  fs.writeFileSync(process.env.SAIDA || 'r5_referencia.json', JSON.stringify(res, null, 1));
})();
