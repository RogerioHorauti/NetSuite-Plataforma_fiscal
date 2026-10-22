// Uma filial da GL por UF no hml (CNPJ 10664687/90NN-DV), para o bundle simular com emitente em todo estado.
// Retomável: pula UF que já tem filial da GL. Grava filiais_uf.json (uf → cnpj, município, IBGE, CEP).
const fs = require('fs');
const { call } = require('./fp_hml.js');
const GL = '10664687000113', BASE8 = '10664687';
const UFS = {
  AC: ['Rio Branco', '69900000'], AL: ['Maceió', '57020000'], AM: ['Manaus', '69005000'], AP: ['Macapá', '68900000'],
  BA: ['Salvador', '40020000'], CE: ['Fortaleza', '60060000'], DF: ['Brasília', '70040000'], ES: ['Vitória', '29010000'],
  GO: ['Goiânia', '74003010'], MA: ['São Luís', '65010000'], MG: ['Belo Horizonte', '30110000'], MS: ['Campo Grande', '79002000'],
  MT: ['Cuiabá', '78005000'], PA: ['Belém', '66010000'], PB: ['João Pessoa', '58010000'], PE: ['Recife', '50010000'],
  PI: ['Teresina', '64000000'], PR: ['Curitiba', '80010000'], RJ: ['Rio de Janeiro', '20010000'], RN: ['Natal', '59010000'],
  RO: ['Porto Velho', '76801000'], RR: ['Boa Vista', '69301000'], RS: ['Porto Alegre', '90010000'], SC: ['Florianópolis', '88010000'],
  SE: ['Aracaju', '49010000'], SP: ['São Paulo', '04547005'], TO: ['Palmas', '77001000']
};
function dv(doze) {
  const calc = (s, p) => { const r = s.split('').reduce((a, d, i) => a + +d * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = calc(doze, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return doze + d1 + calc(doze + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
}
(async () => {
  const lista = await call(GL, 'GET', '/branches');
  if (lista.code !== 200) throw new Error('branches ' + lista.code);
  const matriz = lista.body.find(b => b.cnpj === GL);
  const out = {};
  for (const b of lista.body) if (b.companyId === matriz.companyId && b.ativo) out[b.uf] = out[b.uf] || { cnpj: b.cnpj, municipio: b.municipio, ibge: b.codigoIbgeMunicipio, cep: b.cep, existia: true };
  let ordem = 9001;
  for (const [uf, [mun, cep]] of Object.entries(UFS)) {
    if (out[uf]) { console.log(uf, 'já tem', out[uf].cnpj); continue; }
    const m = await call(GL, 'GET', '/fiscal/municipios?uf=' + uf + '&q=' + encodeURIComponent(mun));
    const ibge = m.code === 200 && (m.body.find(x => x.nome === mun) || {}).codigoIbge;
    if (!ibge) { console.log(uf, 'sem IBGE para', mun, m.code); continue; }
    let cnpj;
    for (;; ordem++) { cnpj = dv(BASE8 + String(ordem).padStart(4, '0')); if (!lista.body.some(b => b.cnpj === cnpj)) break; }
    ordem++;
    const body = { companyId: matriz.companyId, razaoSocial: matriz.razaoSocial, nomeFantasia: 'TESTE ' + uf, cnpj, tipoEstabelecimento: 'FILIAL',
      cnae: matriz.cnae, cnaeDescricao: matriz.cnaeDescricao, logradouro: 'Rua Teste', numero: '1', bairro: 'Centro',
      municipio: mun, uf, cep, codigoIbgeMunicipio: ibge, pais: '1058', regimeTributario: matriz.regimeTributario, herdaRegimeMatriz: true,
      setorAtividadeId: matriz.setorAtividadeId, ativo: true };
    const r = await call(GL, 'POST', '/branches', body);
    console.log(uf, r.code, cnpj, r.code >= 300 ? JSON.stringify(r.body).slice(0, 300) : '');
    if (r.code < 300) out[uf] = { cnpj, municipio: mun, ibge, cep, id: r.body.id };
  }
  fs.writeFileSync('filiais_uf.json', JSON.stringify(out, null, 1));
  console.log('UFs com filial da GL:', Object.keys(out).length);
})();
