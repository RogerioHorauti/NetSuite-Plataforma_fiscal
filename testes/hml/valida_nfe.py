# Valida NF-e 4.00 sem assinatura: injeta uma ds:Signature só de FORMA (o XSD exige o nó; o valor
# criptográfico não é checado por XSD). Uso: valida_nfe.py <nfe_v4.00.xsd> <xml>...
import sys
from lxml import etree
NS = 'http://www.portalfiscal.inf.br/nfe'
SIG = ('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>'
  '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>'
  '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>'
  '<Reference URI="#{id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>'
  '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms>'
  '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue></Reference>'
  '</SignedInfo><SignatureValue>AAAA</SignatureValue><KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>')
xsd = etree.XMLSchema(etree.parse(sys.argv[1]))
for arq in sys.argv[2:]:
    doc = etree.parse(arq); raiz = doc.getroot()
    nfe = raiz if raiz.tag == '{%s}NFe' % NS else raiz.find('{%s}NFe' % NS)
    inf = nfe.find('{%s}infNFe' % NS)
    if nfe.find('{http://www.w3.org/2000/09/xmldsig#}Signature') is None:
        nfe.append(etree.fromstring(SIG.replace('{id}', inf.get('Id'))))
    ok = xsd.validate(etree.ElementTree(nfe))
    print('==', arq.split('/')[-1], 'VALIDO' if ok else 'INVALIDO')
    for e in xsd.error_log: print('  ', e.message[:400])
