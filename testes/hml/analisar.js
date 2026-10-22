// Agrupa as falhas de um ou mais resultados, separando as já conhecidas da rodada 1.
const fs = require('fs');
const CONHECIDAS = [/chaveAcessoReferencia/, /Nota de ENTRADA própria de transferência/, /CFOP 3(551|556|202) ≠/, /natureza sem CFOP/];
for (const arq of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const g = {};
  for (const x of r) {
    if (!x.falhas.length) continue;
    const k = (x.falhas.join(' | ') + ' :: ' + x.msg).replace(/\d{5,}/g, '#').slice(0, 300);
    if (CONHECIDAS.some(re => re.test(k))) continue;
    (g[k] = g[k] || []).push(x.natureza + '/' + x.ambito.slice(0, 5));
  }
  console.log('==', arq);
  for (const [k, v] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) console.log(' ', v.length + 'x', k, '\n     ', v.join(' '));
}
