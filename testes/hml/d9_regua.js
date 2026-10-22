// Detalha a rodada 11 (f9_ns_regua.js): para cada pedido, lê o -payload/-retorno.json gravados pelo bundle e
// imprime por NCM o CFOP e os tributos (CST@alíquota=valor), para o contador conferir cesta, FECP/FECOEP e monofásico.
// Uso: [RODADA=r12] node d9_regua.js [UF...]   → <rodada>_ns_detalhe.json + tabela no console (padrão r11)
const fs = require('fs'); const { call } = require('./ns.js'); const { getFile } = require('./ns_file.js');
const CACHE = 'r10_ns_cache', RODADA = process.env.RODADA || 'r11'; if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE);
(async () => {
  const quais = process.argv.slice(2);
  const pedidos = fs.readFileSync(RODADA + '_ns_pedidos.jsonl', 'utf8').trim().split('\n').map(JSON.parse).filter(p => p.id && (!quais.length || quais.includes(p.uf)));
  const nomes = pedidos.flatMap(p => ['FP-salesorder-' + p.id + '-payload.json', 'FP-salesorder-' + p.id + '-retorno.json']);
  const arqs = Object.fromEntries(JSON.parse((await call('POST', '/query/v1/suiteql?limit=1000', { q: "select id, name from file where name in (" + nomes.map(n => "'" + n + "'").join(',') + ")" })).body).items.map(f => [f.name, f.id]));
  const ler = async n => { const c = CACHE + '/' + n; if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, 'utf8')); if (!arqs[n]) return null; const t = await getFile(arqs[n]); fs.writeFileSync(c, t); return JSON.parse(t); };
  const saida = {};
  for (const p of pedidos) {
    const pay = await ler('FP-salesorder-' + p.id + '-payload.json'), ret = await ler('FP-salesorder-' + p.id + '-retorno.json');
    const corpo = ret && (ret.body || ret);
    const rot = p.uf + (p.grupo ? ' ' + p.grupo : '');
    console.log('\n== ' + rot + ' pedido ' + p.id + ' (' + p.s + 's) payload ' + (pay ? pay.linhas.length + ' linhas' : 'AUSENTE') + ' | retorno ' + (!corpo ? 'AUSENTE' : corpo.linhas ? corpo.linhas.length + ' linhas' : 'RECUSA ' + String(corpo.message || JSON.stringify(corpo)).slice(0, 200)));
    if (!corpo || !corpo.linhas) { saida[rot] = { id: p.id, retorno: corpo || null }; continue; }
    saida[rot] = corpo.linhas.map((l, i) => {
      const trib = l.impostos.map(x => x.taxCodigo + ' ' + (x.cst || '') + '@' + x.aliquota + '=' + x.valor).join(' | ');
      console.log('  ' + String(pay.linhas[i].ncm).padEnd(8) + ' ' + (pay.linhas[i].cest || '').padEnd(7) + ' ' + l.cfopCodigo + '  ' + trib);
      return { ncm: pay.linhas[i].ncm, cest: pay.linhas[i].cest, cfop: l.cfopCodigo, impostos: l.impostos };
    });
  }
  fs.writeFileSync(RODADA + '_ns_detalhe.json', JSON.stringify(saida, null, 1));
})();
