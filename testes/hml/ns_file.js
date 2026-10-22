// Lê um arquivo do File Cabinet pelo SOAP get (tokenPassport HMAC-SHA256). Uso: node ns_file.js <id> [saida]
const fs = require('fs'), crypto = require('crypto'), https = require('https');
const L = fs.readFileSync('C:/Users/TI/Documents/GitHub/NetSuite-Plataforma_fiscal/Consumer Key  Client ID-1.txt', 'utf8').split(/\r?\n/).map(s => s.trim());
const ck = L[1], cs = L[3], tk = L[6], ts = L[8], acct = 'TSTDRV1647270';
const HOST = 'tstdrv1647270.suitetalk.api.netsuite.com', PATH = '/services/NetSuitePort_2024_2';
function passport() {
  const nonce = crypto.randomBytes(16).toString('hex'), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', cs + '&' + ts).update([acct, ck, tk, nonce, t].join('&')).digest('base64');
  return '<tokenPassport><account>' + acct + '</account><consumerKey>' + ck + '</consumerKey><token>' + tk + '</token><nonce>' + nonce +
    '</nonce><timestamp>' + t + '</timestamp><signature algorithm="HMAC-SHA256">' + sig + '</signature></tokenPassport>';
}
function getFile(id) {
  const env = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:msgs="urn:messages_2024_2.platform.webservices.netsuite.com" xmlns:core="urn:core_2024_2.platform.webservices.netsuite.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<soapenv:Header>' + passport() + '</soapenv:Header><soapenv:Body><msgs:get><msgs:baseRef xsi:type="core:RecordRef" internalId="' + id + '" type="file"/></msgs:get></soapenv:Body></soapenv:Envelope>';
  return new Promise((res, rej) => {
    const r = https.request({ host: HOST, path: PATH, method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'get' } }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => {
        const m = d.match(/<[^>]*content>([^<]*)<\/[^>]*content>/);
        if (!m) return rej(new Error('SOAP ' + x.statusCode + ' ' + d.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300)));
        res(Buffer.from(m[1], 'base64').toString('utf8'));
      });
    });
    r.on('error', rej); r.write(env); r.end();
  });
}
module.exports = { getFile };
if (require.main === module) getFile(process.argv[2]).then(t => process.argv[3] ? fs.writeFileSync(process.argv[3], t) : console.log(t)).catch(e => { console.error(e.message); process.exit(1); });
