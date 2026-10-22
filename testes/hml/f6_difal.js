// Rodada 6 — DIFAL: VENDA de SP para não contribuinte (CPF, consumidor final) em cada UF.
// Leitura: alíquota interestadual, alíquota interna de destino, DIFAL e FCP por UF. Item nacional
// (origem 0) e importado (origem 1, 4%). Sem 5xx; o resto é tabela para o contador conferir.
const fs = require('fs');
const { call } = require('./fp_hml.js');
const EMP = process.env.EMP || '10664687000113';

// Capital e CEP de cada UF (o município entra só para o endereço ficar coerente).
const UFS = {
  AC: ['Rio Branco', '69900000'], AL: ['Maceió', '57020000'], AM: ['Manaus', '69005000'], AP: ['Macapá', '68900000'],
  BA: ['Salvador', '40020000'], CE: ['Fortaleza', '60060000'], DF: ['Brasília', '70040000'], ES: ['Vitória', '29010000'],
  GO: ['Goiânia', '74003010'], MA: ['São Luís', '65010000'], MG: ['Belo Horizonte', '30110000'], MS: ['Campo Grande', '79002000'],
  MT: ['Cuiabá', '78005000'], PA: ['Belém', '66010000'], PB: ['João Pessoa', '58010000'], PE: ['Recife', '50010000'],
  PI: ['Teresina', '64000000'], PR: ['Curitiba', '80010000'], RJ: ['Rio de Janeiro', '20010000'], RN: ['Natal', '59010000'],
  RO: ['Porto Velho', '76801000'], RR: ['Boa Vista', '69301000'], RS: ['Porto Alegre', '90010000'], SC: ['Florianópolis', '88010000'],
  SE: ['Aracaju', '49010000'], TO: ['Palmas', '77001000']
};

(async () => {
  const res = [];
  for (const [uf, [mun, cep]] of Object.entries(UFS)) for (const origem of ['0', '1']) {
    const payload = {
      cnpjEmpresa: EMP, naturezaOperacaoId: 'VENDA', dataEmissao: '2026-10-20',
      contraparte: { nome: 'Consumidor ' + uf, cnpjCpf: '39053344705', indIe: 9, regimeTributario: 'PF',
        logradouro: 'Rua T', numero: '1', bairro: 'Centro', municipio: mun, uf, cep, pais: '1058' },
      linhas: [{ numeroItem: 1, valorProduto: 100, quantidade: 1, valorTotal: 100, valorBruto: 100, descricao: 'Item', unidade: 'UN',
        codigoProduto: 'T', ncm: '85176272', cest: '2111000', origemProduto: origem }]
    };
    let r; try { r = await call(EMP, 'POST', '/fiscal/simular', payload); } catch (e) { r = { code: 'EXC', body: e.message }; }
    const l0 = r.code === 200 && r.body.linhas[0];
    const t = c => l0 && l0.impostos.find(i => i.taxCodigo === c);
    const icms = t('ICMS'), difal = t('ICMS_DIFAL'), fcp = l0 && l0.impostos.find(i => /FCP/.test(i.taxCodigo));
    const linha = {
      uf, origem, code: r.code, cfop: l0 && l0.cfopCodigo,
      icmsAliq: icms && icms.aliquota, icms: icms && icms.valor,
      difalAliq: difal && difal.aliquota, difalBase: difal && difal.baseCalculo, difal: difal && difal.valor,
      fcp: fcp ? fcp.taxCodigo + '@' + fcp.aliquota + '=' + fcp.valor : '',
      comentario: difal && difal.comentario,
      msg: r.code === 200 ? '' : String(r.body.message || JSON.stringify(r.body)).slice(0, 200)
    };
    res.push(Object.assign({ resposta: r.body }, linha));
    console.log([uf, 'orig' + origem, r.code, linha.cfop, 'ICMS ' + linha.icmsAliq + '%=' + linha.icms,
      'DIFAL ' + linha.difalAliq + '% base ' + linha.difalBase + '=' + linha.difal, linha.fcp, linha.msg].join(' | '));
  }
  fs.writeFileSync(process.env.SAIDA || 'r6_difal.json', JSON.stringify(res, null, 1));
})();
