// Lê o GL de uma transação e o log do plug-in pelo corrId dela.
// Uso: node gl_ver.js <id da transação>
const { sql } = require('./ns.js');
(async () => {
  const id = process.argv[2];
  const t = JSON.parse((await sql("select custbody_fp_corrid c from transaction where id=" + id)).body).items[0];
  const r = JSON.parse((await sql("select a.acctnumber, a.fullname, tal.debit, tal.credit from transactionaccountingline tal join account a on a.id=tal.account where tal.transaction=" + id + " order by a.acctnumber")).body);
  r.items.forEach(x => console.log(x.acctnumber.padEnd(8), x.fullname.padEnd(34), (x.debit || '').padStart(8), (x.credit || '').padStart(8)));
  const s = JSON.parse((await sql("select n.internalid, n.type, substr(n.detail,1,300) d from scriptnote n where n.date > sysdate - 1/24 and n.title like 'fp_gl%' and n.detail like '%" + t.c + "%' order by n.internalid desc fetch first 3 rows only")).body);
  s.items.forEach(x => console.log(x.internalid, x.type, x.d));
})();
