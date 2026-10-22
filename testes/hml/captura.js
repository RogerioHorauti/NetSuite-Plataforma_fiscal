// Captura XML(s) autorizados no hml pela empresa do token. Uso: node captura.js <cnpj> <arquivo.xml>...
// A credencial é lida em memória (fp_hml.js); nada de segredo é impresso.
const fs = require('fs');
const path = require('path');
const { BASE, token } = require('./fp_hml.js');
(async () => {
  const [cnpj, ...arqs] = process.argv.slice(2);
  for (const f of arqs) {
    const fd = new FormData();
    fd.append('arquivo', new Blob([fs.readFileSync(f)], { type: 'application/xml' }), path.basename(f));
    fd.append('cnpjEmpresa', cnpj);
    const r = await fetch(BASE + '/transacoes/captura', { method: 'POST', headers: { Authorization: 'Bearer ' + await token(cnpj) }, body: fd });
    const t = await r.text(); let b; try { b = JSON.parse(t); } catch (e) { b = { message: t }; }
    console.log(path.basename(f), r.status, b.entradaSaida || '', b.branchCnpj || '', b.status || '', String(b.message || '').slice(0, 300));
  }
})();
