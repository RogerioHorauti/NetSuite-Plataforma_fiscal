// uso: node ns.js METHOD path [bodyFile]   (path relativo a /services/rest)
const fs=require('fs'),crypto=require('crypto'),https=require('https');
const L=fs.readFileSync('C:/Users/TI/Documents/GitHub/NetSuite-Plataforma_fiscal/Consumer Key  Client ID-1.txt','utf8').split(/\r?\n/).map(s=>s.trim());
const ck=L[1],cs=L[3],tk=L[6],ts=L[8],realm='TSTDRV1647270',host='tstdrv1647270.suitetalk.api.netsuite.com';
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
function call(method,path,body,extra){return new Promise((res,rej)=>{
 const u=new URL('https://'+host+'/services/rest'+path);
 const o={oauth_consumer_key:ck,oauth_token:tk,oauth_signature_method:'HMAC-SHA256',oauth_timestamp:Math.floor(Date.now()/1000)+'',oauth_nonce:crypto.randomBytes(12).toString('hex'),oauth_version:'1.0'};
 const p=[...Object.entries(o),...[...u.searchParams.entries()]].map(([k,v])=>[enc(k),enc(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:1);
 const base=[method,enc(u.origin+u.pathname),enc(p.map(x=>x.join('=')).join('&'))].join('&');
 o.oauth_signature=crypto.createHmac('sha256',enc(cs)+'&'+enc(ts)).update(base).digest('base64');
 const auth='OAuth realm="'+realm+'",'+Object.entries(o).map(([k,v])=>k+'="'+enc(v)+'"').join(',');
 const r=https.request(u,{method,headers:Object.assign({Authorization:auth,'Content-Type':'application/json',Prefer:'transient'},extra||{})},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({code:x.statusCode,loc:x.headers.location,body:d}))});
 r.on('error',rej); if(body) r.write(typeof body==='string'?body:JSON.stringify(body)); r.end();});}
module.exports={call,sql:q=>call('POST','/query/v1/suiteql?limit=1000',{q})};
if(require.main===module){const[,,m,pth,bf]=process.argv;call(m,pth,bf?fs.readFileSync(bf,'utf8'):null).then(r=>console.log(r.code,r.loc||'',r.body.slice(0,3000)));}
