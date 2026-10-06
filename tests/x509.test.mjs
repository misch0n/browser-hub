// X.509 certificates and CSRs decoded by js/lib/x509.js. The fixtures were made
// with OpenSSL (tests/fixtures/x509/gen.sh) and the expected values copied from
// `openssl x509 -noout -text -fingerprint`; Node's own X509Certificate and
// WebCrypto check the rest at run time. No OpenSSL needed to run this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { pemBlocks, parseDer, decodeCertificate, decodeCsr, fingerprints, oidName, toHex } from '../js/lib/x509.js';

const read = (name) => readFileSync(new URL('./fixtures/x509/' + name, import.meta.url), 'utf8');
const RSA = read('rsa-selfsigned.pem');
const CA = read('ec-ca.pem');
const LEAF = read('ec-leaf.pem');
const ED = read('ed25519.pem');
const CSR = read('csr.pem');
const der = (pem) => pemBlocks(pem)[0].der;
const ext = (c, name) => c.extensions.find((e) => e.name === name);

// ---- PEM --------------------------------------------------------------------

test('x509: pemBlocks finds every block, with CRLF and text around them', () => {
  const text = 'Bag Attributes: junk\r\nsubject=CN = x\r\n' + RSA.replace(/\n/g, '\r\n') + '\r\nsome text\n' + CSR + '\n  ' + CA.replace(/\n/g, '\n   ') + 'trailer';
  const blocks = pemBlocks(text);
  assert.deepEqual(blocks.map((b) => b.label), ['CERTIFICATE', 'CERTIFICATE REQUEST', 'CERTIFICATE']);
  assert.deepEqual(blocks[0].der, der(RSA));
  assert.deepEqual(blocks[2].der, der(CA));
  assert.equal(blocks[0].der[0], 0x30);
});

test('x509: pemBlocks reads bare base64 and hex DER, guessing the label', () => {
  const body = (pem) => pem.replace(/-----[^-]+-----/g, '');
  const certDer = der(LEAF);
  assert.deepEqual(pemBlocks(body(LEAF)), [{ label: 'CERTIFICATE', der: certDer }]);
  assert.deepEqual(pemBlocks(body(LEAF).replace(/\s/g, '')), [{ label: 'CERTIFICATE', der: certDer }]);
  assert.equal(pemBlocks(body(CSR))[0].label, 'CERTIFICATE REQUEST');
  const hex = toHex(certDer, '').toLowerCase();
  assert.deepEqual(pemBlocks(hex)[0], { label: 'CERTIFICATE', der: certDer });
  assert.deepEqual(pemBlocks(toHex(certDer, ':'))[0].der, certDer);
  assert.deepEqual(pemBlocks(hex.replace(/(.{64})/g, '$1\n'))[0].der, certDer);
  const spki = decodeCertificate(RSA).publicKey.spki;
  assert.equal(pemBlocks(Buffer.from(spki).toString('base64'))[0].label, 'PUBLIC KEY');
  assert.equal(pemBlocks('-----BEGIN PUBLIC KEY-----\n' + Buffer.from(spki).toString('base64') + '\n-----END PUBLIC KEY-----')[0].label, 'PUBLIC KEY');
});

test('x509: pemBlocks rejects garbage clearly', () => {
  assert.throws(() => pemBlocks(''), /nothing to decode/);
  assert.throws(() => pemBlocks('hello, world!'), /no PEM block, base64 or hex DER found/);
  assert.throws(() => pemBlocks('-----BEGIN CERTIFICATE-----\nMIIB$$$\n-----END CERTIFICATE-----'), /CERTIFICATE block isn't valid base64/);
  assert.throws(() => pemBlocks(RSA.replace(/-----END[^\n]*/, '')), /no matching END/);
  assert.throws(() => pemBlocks('aGVsbG8gd29ybGQ='), /not to DER/); // base64 of "hello world"
  assert.throws(() => decodeCertificate('-----BEGIN CERTIFICATE-----\naGVsbG8gd29ybGQ=\n-----END CERTIFICATE-----'), /DER/);
});

// ---- DER --------------------------------------------------------------------

test('x509: parseDer gives a tree with offsets', () => {
  const bytes = der(ED);
  const root = parseDer(bytes);
  assert.equal(root.tag, 16);
  assert.equal(root.cls, 'universal');
  assert.equal(root.constructed, true);
  assert.equal(root.start, 0);
  assert.equal(root.headerLength + root.length, bytes.length);
  assert.equal(root.children.length, 3);
  const [tbs, , sig] = root.children;
  assert.equal(tbs.children[0].cls, 'context');
  assert.equal(tbs.children[0].tag, 0);
  assert.equal(sig.tag, 3);
  assert.equal(sig.constructed, false);
  assert.equal(sig.children, undefined);
  assert.equal(sig.value.length, 65);
  // Short and long lengths, a multi-byte tag number.
  assert.equal(parseDer(new Uint8Array([0x04, 0x81, 0x80, ...new Array(128).fill(7)])).length, 128);
  const hi = parseDer(new Uint8Array([0x9f, 0x81, 0x00, 0x01, 0xff]));
  assert.deepEqual([hi.cls, hi.tag, hi.headerLength, hi.value[0]], ['context', 128, 4, 0xff]);
});

test('x509: parseDer rejects truncated, indefinite and trailing data', () => {
  const bytes = der(RSA);
  assert.throws(() => parseDer(bytes.subarray(0, 100)), /DER truncated: the element at offset 0 needs \d+ bytes, \d+ remain/);
  assert.throws(() => parseDer(bytes.subarray(0, 1)), /DER truncated at offset 1: expected a length/);
  assert.throws(() => parseDer(new Uint8Array([0x30, 0x80, 0x00, 0x00])), /indefinite length at offset 0 \(BER, not DER\)/);
  assert.throws(() => parseDer(new Uint8Array([0x30, 0x03, 0x02, 0x05, 0x01])), /truncated.*offset 2 needs 5 bytes, 1 remain/);
  assert.throws(() => parseDer(new Uint8Array([0x02, 0x01, 0x00, 0x00])), /1 trailing bytes/);
  assert.throws(() => parseDer(new Uint8Array([])), /DER is empty/);
  assert.throws(() => parseDer(new Uint8Array([0x04, 0x85, 1, 0, 0, 0, 0])), /too large/);
  assert.throws(() => decodeCertificate(bytes.subarray(0, bytes.length - 1)), /DER truncated/);
  assert.throws(() => decodeCertificate(der(CSR)), /this is a certificate request \(CSR\), not a certificate/);
  assert.throws(() => decodeCsr(der(RSA)), /this is a certificate, not a certificate request/);
  assert.throws(() => decodeCsr(new Uint8Array([0x30, 0x00])), /not a PKCS#10 certificate request/);
  assert.throws(() => decodeCertificate(new Uint8Array([0x02, 0x01, 0x05])), /not an X.509 certificate/);
});

// ---- certificates (expected values from `openssl x509 -text`) ----------------------

test('x509: self-signed RSA-2048 certificate', async () => {
  const c = decodeCertificate(der(RSA));
  assert.equal(c.version, 3);
  assert.equal(c.serialNumber, '5A:17:C0:FF:EE:01:23');
  assert.deepEqual(c.signatureAlgorithm, { oid: '1.2.840.113549.1.1.11', name: 'sha256WithRSAEncryption' });
  const dn = 'emailAddress=admin@example.test, CN=example.test, OU=Platform Team, O=Example GmbH, L=Berlin, ST=Berlin, C=DE';
  assert.equal(c.subject.dn, dn);
  assert.equal(c.issuer.dn, dn);
  assert.deepEqual(c.subject.attrs.map((a) => a.name + '=' + a.value), ['C=DE', 'ST=Berlin', 'L=Berlin', 'O=Example GmbH', 'OU=Platform Team', 'CN=example.test', 'emailAddress=admin@example.test']);
  assert.equal(c.subject.attrs[6].oid, '1.2.840.113549.1.9.1');
  assert.equal(c.selfSigned, true);
  assert.equal(c.validity.notBefore.toISOString(), '2025-01-01T00:00:00.000Z');
  assert.equal(c.validity.notAfter.toISOString(), '2035-01-01T00:00:00.000Z');
  assert.equal(c.publicKey.algorithm, 'RSA');
  assert.equal(c.publicKey.bits, 2048);
  assert.equal(c.publicKey.exponent, 65537);
  assert.match(c.publicKey.modulus, /^A5:69:4B:DD:6E:28:84:4A:.*:F6:BE:7C:5B:5D$/);
  assert.deepEqual(ext(c, 'basicConstraints'), { oid: '2.5.29.19', name: 'basicConstraints', critical: true, value: { ca: false, pathLen: null } });
  assert.deepEqual(ext(c, 'keyUsage').value, ['digitalSignature', 'keyEncipherment']);
  assert.equal(ext(c, 'keyUsage').critical, true);
  assert.deepEqual(ext(c, 'extKeyUsage').value, ['serverAuth', 'clientAuth']);
  assert.equal(ext(c, 'extKeyUsage').critical, false);
  assert.equal(ext(c, 'subjectKeyIdentifier').value, 'D2:D5:C5:13:47:3C:5D:81:59:00:37:97:91:D1:0E:73:9D:19:5E:D3');
  assert.deepEqual(c.sans, ['DNS:example.test', 'DNS:www.example.test', 'DNS:*.api.example.test', 'IP:192.0.2.10', 'IP:2001:db8::1', 'email:admin@example.test']);
  assert.deepEqual(ext(c, 'subjectAltName').value[4], { type: 'IP', value: '2001:db8::1' });
  assert.equal(c.signature.length, 256);
  assert.equal(toHex(c.signature.subarray(0, 4)), '08:B1:F6:1D');
  assert.deepEqual(await fingerprints(der(RSA)), {
    sha1: '5A:41:3C:6C:09:BB:A5:12:93:2A:F3:7E:28:D3:5F:35:1F:E4:E3:67',
    sha256: 'F5:94:BA:AD:0B:E3:31:9D:D7:6B:52:64:18:9A:ED:96:59:08:5E:84:58:1F:0A:A8:3E:5B:85:E9:B9:5B:52:95',
  });
  // The SPKI imports into WebCrypto and verifies the certificate's own signature.
  const key = await crypto.subtle.importKey('spki', c.publicKey.spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, c.signature, c.tbs), true);
});

test('x509: EC P-384 CA certificate', async () => {
  const c = decodeCertificate(CA); // PEM text works too
  assert.equal(c.serialNumber, '01');
  assert.equal(c.subject.dn, 'CN=Example Test Root CA, O=Example Trust, C=US');
  assert.equal(c.selfSigned, true);
  assert.deepEqual(c.signatureAlgorithm, { oid: '1.2.840.10045.4.3.3', name: 'ecdsa-with-SHA384' });
  assert.deepEqual([c.publicKey.algorithm, c.publicKey.curve, c.publicKey.bits], ['EC', 'P-384', 384]);
  assert.deepEqual(ext(c, 'basicConstraints').value, { ca: true, pathLen: 0 });
  assert.deepEqual(ext(c, 'keyUsage').value, ['keyCertSign', 'cRLSign']);
  assert.equal(ext(c, 'subjectKeyIdentifier').value, 'C3:3B:78:FA:73:25:9A:6B:15:95:E9:B2:B6:B8:A7:4C:03:74:C1:55');
  assert.deepEqual(c.sans, []);
  assert.equal((await fingerprints(der(CA))).sha256, 'A5:F3:A4:76:8A:EB:CD:AF:E4:29:CB:1A:2A:79:13:DC:3C:0C:F6:1D:AE:1E:6E:BB:E9:F1:E9:EB:5D:6D:04:B6');
});

// ECDSA-Sig-Value (DER SEQUENCE of r, s) -> r||s, as WebCrypto wants it.
function ecdsaRaw(sig, size) {
  const [r, s] = parseDer(sig).children.map((n) => {
    const v = n.value[0] === 0 ? n.value.subarray(1) : n.value;
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  });
  return new Uint8Array([...r, ...s]);
}

test('x509: EC P-256 leaf signed by the CA', async () => {
  const c = decodeCertificate(der(LEAF));
  const ca = decodeCertificate(der(CA));
  assert.equal(c.version, 3);
  assert.equal(c.serialNumber, 'A1:B2:C3:D4:E5:F6:07:18'); // DER has a 00 sign byte in front
  assert.equal(c.subject.dn, 'CN=leaf.example.test, O=Example Leaf Inc., C=US');
  assert.equal(c.issuer.dn, 'CN=Example Test Root CA, O=Example Trust, C=US');
  assert.equal(c.issuer.dn, ca.subject.dn);
  assert.equal(c.selfSigned, false);
  assert.equal(c.validity.notBefore.toISOString(), '2025-03-15T08:30:00.000Z');
  assert.equal(c.validity.notAfter.toISOString(), '2051-03-15T08:30:00.000Z'); // GeneralizedTime
  assert.deepEqual([c.publicKey.algorithm, c.publicKey.curve, c.publicKey.bits, c.publicKey.oid], ['EC', 'P-256', 256, '1.2.840.10045.2.1']);
  assert.deepEqual(ext(c, 'basicConstraints'), { oid: '2.5.29.19', name: 'basicConstraints', critical: false, value: { ca: false, pathLen: null } });
  assert.deepEqual(ext(c, 'keyUsage').value, ['digitalSignature']);
  assert.deepEqual(ext(c, 'extKeyUsage').value, ['serverAuth', 'codeSigning', 'emailProtection', 'timeStamping', 'OCSPSigning']);
  assert.equal(ext(c, 'subjectKeyIdentifier').value, 'D7:67:38:DB:96:FA:45:77:81:38:82:B5:26:67:57:A3:5C:AB:4D:CB');
  assert.deepEqual(ext(c, 'authorityKeyIdentifier').value, { keyid: 'C3:3B:78:FA:73:25:9A:6B:15:95:E9:B2:B6:B8:A7:4C:03:74:C1:55' });
  assert.equal(ext(c, 'authorityKeyIdentifier').value.keyid, ext(ca, 'subjectKeyIdentifier').value);
  assert.deepEqual(ext(c, 'authorityInfoAccess').value, { ocsp: ['http://ocsp.example.test'], caIssuers: ['http://ca.example.test/ca.crt'], other: [] });
  assert.deepEqual(ext(c, 'cRLDistributionPoints').value, ['http://crl.example.test/ca.crl']);
  assert.deepEqual(ext(c, 'certificatePolicies').value, [
    { oid: '2.23.140.1.2.1', name: 'domainValidated', cps: [] },
    { oid: '1.3.6.1.4.1.55555.1.2', name: '1.3.6.1.4.1.55555.1.2', cps: [] },
  ]);
  assert.deepEqual(c.sans, ['DNS:leaf.example.test', 'URI:https://leaf.example.test/id', 'IP:10.1.2.3']);
  assert.deepEqual(await fingerprints(der(LEAF)), {
    sha1: '4C:4E:E4:8F:A5:6F:47:74:3D:AE:C8:30:6C:02:67:7F:44:F5:58:B1',
    sha256: '0C:72:42:E4:CE:E4:2D:47:7B:8F:AE:C6:10:39:DF:F9:6B:76:84:2F:2C:42:AE:4D:40:01:A9:01:CA:66:28:03',
  });
  // Both keys import; the CA's key verifies the leaf's signature.
  await crypto.subtle.importKey('spki', c.publicKey.spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const caKey = await crypto.subtle.importKey('spki', ca.publicKey.spki, { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-384' }, caKey, ecdsaRaw(c.signature, 48), c.tbs), true);
});

test('x509: self-signed Ed25519 certificate', async () => {
  const c = decodeCertificate(der(ED));
  assert.equal(c.serialNumber, '2A');
  assert.deepEqual(c.signatureAlgorithm, { oid: '1.3.101.112', name: 'Ed25519' });
  assert.equal(c.subject.dn, 'CN=ed25519.example.test, O=Example');
  assert.equal(c.selfSigned, true);
  assert.deepEqual([c.publicKey.algorithm, c.publicKey.bits, c.publicKey.spki.length], ['Ed25519', 256, 44]);
  assert.equal(c.validity.notAfter.toISOString(), '2027-07-01T00:00:00.000Z');
  assert.deepEqual(c.sans, ['DNS:ed25519.example.test']);
  assert.deepEqual(c.extensions.map((e) => e.name), ['basicConstraints', 'keyUsage', 'subjectAltName', 'subjectKeyIdentifier']);
  assert.equal(ext(c, 'subjectKeyIdentifier').value, '63:24:47:BA:80:6E:EC:0E:99:BB:AA:F1:87:AD:B7:8B:82:AD:82:3D');
  assert.equal((await fingerprints(der(ED))).sha256, '96:F2:5B:4E:FE:27:CD:77:DB:59:42:33:F2:EC:0D:72:5F:56:2E:31:05:2E:DD:07:B5:E0:68:ED:6C:94:2E:D7');
  const key = await crypto.subtle.importKey('spki', c.publicKey.spki, { name: 'Ed25519' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify('Ed25519', key, c.signature, c.tbs), true);
});

// ---- Node's X509Certificate agrees ------------------------------------------------

// Node prints IPv6 SANs as OpenSSL does (2001:DB8:0:0:0:0:0:1); compress to RFC 5952.
function nodeSans(s) {
  if (!s) return [];
  return s.split(', ').map((x) => {
    if (!x.startsWith('IP Address:')) return x;
    let ip = x.slice(11).toLowerCase();
    if (ip.includes(':')) {
      ip = ip.split(':').map((g) => g.replace(/^0+(?=.)/, '')).join(':');
      const runs = ip.match(/(?:^|:)0(?::0)+(?::|$)/g) || [];
      const longest = runs.sort((a, b) => b.length - a.length)[0];
      if (longest) ip = ip.replace(longest, '::');
    }
    return 'IP:' + ip;
  });
}

test('x509: matches node:crypto X509Certificate', async () => {
  for (const pem of [RSA, CA, LEAF, ED]) {
    const n = new X509Certificate(pem);
    const c = decodeCertificate(pem);
    assert.equal(c.subject.attrs.map((a) => a.name + '=' + a.value).join('\n'), n.subject);
    assert.equal(c.issuer.attrs.map((a) => a.name + '=' + a.value).join('\n'), n.issuer);
    assert.equal(c.validity.notBefore.getTime(), new Date(n.validFrom).getTime());
    assert.equal(c.validity.notAfter.getTime(), new Date(n.validTo).getTime());
    assert.deepEqual(c.sans, nodeSans(n.subjectAltName));
    assert.equal(c.serialNumber.replace(/:/g, ''), n.serialNumber);
    assert.equal((await fingerprints(pem)).sha256, n.fingerprint256);
    assert.equal((await fingerprints(pem)).sha1, n.fingerprint);
    assert.equal(c.selfSigned, n.verify(n.publicKey)); // signed by its own key
    assert.equal(ext(c, 'basicConstraints').value.ca, n.ca);
    const eku = ext(c, 'extKeyUsage');
    assert.deepEqual(eku ? eku.value.map((name) => Object.keys(OIDS).find((o) => OIDS[o] === name)) : undefined, n.keyUsage);
    const details = n.publicKey.asymmetricKeyDetails;
    if (c.publicKey.algorithm === 'RSA') assert.deepEqual([c.publicKey.bits, BigInt(c.publicKey.exponent)], [details.modulusLength, details.publicExponent]);
    if (c.publicKey.algorithm === 'EC') assert.equal({ 'P-256': 'prime256v1', 'P-384': 'secp384r1' }[c.publicKey.curve], details.namedCurve);
    assert.equal(c.publicKey.algorithm.toLowerCase(), n.publicKey.asymmetricKeyType);
    assert.deepEqual(Buffer.from(c.publicKey.spki), n.publicKey.export({ type: 'spki', format: 'der' }));
  }
  assert.equal(new X509Certificate(LEAF).checkIssued(new X509Certificate(CA)), true);
});
const OIDS = { '1.3.6.1.5.5.7.3.1': 'serverAuth', '1.3.6.1.5.5.7.3.2': 'clientAuth', '1.3.6.1.5.5.7.3.3': 'codeSigning', '1.3.6.1.5.5.7.3.4': 'emailProtection', '1.3.6.1.5.5.7.3.8': 'timeStamping', '1.3.6.1.5.5.7.3.9': 'OCSPSigning' };

// ---- CSR --------------------------------------------------------------------

test('x509: CSR with SANs in its extensionRequest', async () => {
  const r = decodeCsr(der(CSR));
  assert.equal(r.version, 1);
  assert.equal(r.subject.dn, 'CN=csr.example.test, O=Example Ltd, C=GB');
  assert.deepEqual([r.publicKey.algorithm, r.publicKey.bits, r.publicKey.exponent], ['RSA', 3072, 65537]);
  assert.match(r.publicKey.modulus, /^BB:57:9B:0E:30:BF:78:46:.*:62:88:E0:E3$/);
  assert.deepEqual(r.signatureAlgorithm, { oid: '1.2.840.113549.1.1.11', name: 'sha256WithRSAEncryption' });
  assert.deepEqual(r.sans, ['DNS:csr.example.test', 'DNS:alt.example.test', 'IP:198.51.100.7', 'IP:fe80::1:2']);
  assert.deepEqual(r.extensions.map((e) => [e.name, e.critical]), [['subjectAltName', false], ['keyUsage', true], ['extKeyUsage', false]]);
  assert.deepEqual(ext(r, 'keyUsage').value, ['digitalSignature']);
  assert.deepEqual(ext(r, 'extKeyUsage').value, ['clientAuth']);
  assert.deepEqual(r.attributes.map((a) => a.name), ['challengePassword', 'extensionRequest']);
  assert.equal(r.attributes[0].value, 'fixture-secret');
  assert.equal(r.attributes[1].value, r.extensions);
  assert.deepEqual(decodeCsr(CSR).sans, r.sans); // PEM text works too
  // The request is signed with its own key.
  const key = await crypto.subtle.importKey('spki', r.publicKey.spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, r.signature, r.tbs), true);
});

// ---- hand-built DER: the corners the fixtures don't reach --------------------------

// A DER element from a tag byte and contents.
function tlv(tag, ...parts) {
  const body = parts.flatMap((p) => (typeof p === 'number' ? [p] : Array.from(p)));
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return new Uint8Array([tag, ...len, ...body]);
}
const ascii = (s) => new TextEncoder().encode(s);
function oid(dotted) {
  const a = dotted.split('.').map(Number);
  const out = [];
  for (const n of [a[0] * 40 + a[1], ...a.slice(2)]) {
    const g = [n & 0x7f];
    for (let m = Math.floor(n / 128); m; m = Math.floor(m / 128)) g.unshift((m & 0x7f) | 0x80);
    out.push(...g);
  }
  return tlv(0x06, out);
}
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const bmp = (s) => tlv(0x1e, Array.from(s).flatMap((ch) => [ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 0xff]));
const attr = (o, value) => set(seq(oid(o), value));

// 2.25.<a 64-bit arc>, as UUID OIDs are.
const BIG_OID = [0x69, 0x81, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f];

function syntheticCert({ version = true, extensions = true } = {}) {
  const name = seq(
    attr('0.9.2342.19200300.100.1.25', tlv(0x16, ascii('example'))),
    attr('2.5.4.10', tlv(0x0c, ascii('Smith, Jones + Co <"x">'))),
    tlv(0x31, seq(oid('2.5.4.11'), tlv(0x13, ascii('A'))), seq(oid('2.5.4.11'), tlv(0x13, ascii('B')))),
    attr('2.5.4.3', bmp('Ünïcode ')),
    attr('1.2.3.4.5', tlv(0x02, 0x05)),
  );
  const subject = seq(attr('2.5.4.3', tlv(0x0c, ascii('#hash'))));
  const san = seq(
    tlv(0xa0, oid('1.3.6.1.4.1.311.20.2.3'), tlv(0xa0, tlv(0x0c, ascii('user@corp.example')))),
    tlv(0x88, oid('1.2.3.4').subarray(2)),
    tlv(0xa4, name),
    tlv(0x87, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
    tlv(0x87, [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]),
    tlv(0x87, [0xfe, 0x80, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]),
  );
  const exts = seq(
    seq(oid('2.5.29.17'), tlv(0x04, san)),
    seq(oid('1.2.3.4.99'), tlv(0x01, 0xff), tlv(0x04, 0xde, 0xad, 0xbe, 0xef)),
    seq(oid('2.5.29.19'), tlv(0x01, 0xff), tlv(0x04, 0x05, 0x00)), // not a SEQUENCE: unreadable
    seq(oid('2.5.29.15'), tlv(0x04, tlv(0x03, 0x07, 0x80, 0x80))), // digitalSignature + decipherOnly
    seq(tlv(0x06, BIG_OID), tlv(0x04, 0x05, 0x00)),
  );
  const spki = decodeCertificate(ED).publicKey.spki;
  const tbs = seq(
    version ? tlv(0xa0, tlv(0x02, 0x02)) : [],
    tlv(0x02, 0xff, 0x01), // a negative serial (invalid, but seen)
    seq(oid('1.3.101.112')),
    name,
    seq(tlv(0x17, ascii('991231235959Z')), tlv(0x18, ascii('20500101000000.5Z'))),
    subject,
    spki,
    extensions ? tlv(0xa3, exts) : [],
  );
  return seq(tbs, seq(oid('1.3.101.112')), tlv(0x03, 0x00, new Uint8Array(64)));
}

test('x509: names, times and general names from hand-built DER', () => {
  const c = decodeCertificate(syntheticCert());
  assert.equal(c.version, 3);
  assert.equal(c.serialNumber, 'FF:01');
  assert.equal(c.issuer.dn, '1.2.3.4.5=#020105, CN=Ünïcode\\ , OU=A+OU=B, O=Smith\\, Jones \\+ Co \\<\\"x\\"\\>, DC=example');
  assert.deepEqual(c.issuer.attrs.map((a) => a.name), ['DC', 'O', 'OU', 'OU', 'CN', '1.2.3.4.5']);
  assert.equal(c.issuer.attrs[4].value, 'Ünïcode ');
  assert.equal(c.subject.dn, 'CN=\\#hash');
  assert.equal(c.selfSigned, false);
  assert.equal(c.validity.notBefore.toISOString(), '1999-12-31T23:59:59.000Z');
  assert.equal(c.validity.notAfter.toISOString(), '2050-01-01T00:00:00.500Z');
  assert.deepEqual(c.sans, [
    'otherName:UPN:user@corp.example',
    'RID:1.2.3.4',
    'DirName:' + c.issuer.dn,
    'IP:::1',
    'IP:2001:db8:0:1::',
    'IP:fe80:1::1:0:0:1',
  ]);
  assert.deepEqual(c.extensions[1], { oid: '1.2.3.4.99', name: '1.2.3.4.99', critical: true, value: 'DE:AD:BE:EF' });
  assert.equal(c.extensions[2].name, 'basicConstraints');
  assert.equal(c.extensions[2].value, '05:00');
  assert.match(c.extensions[2].error, /malformed basicConstraints/);
  assert.deepEqual(c.extensions[3].value, ['digitalSignature', 'decipherOnly']);
  assert.equal(c.signature.length, 64);
});

test('x509: a v1 certificate (no version, no extensions)', () => {
  const bytes = syntheticCert({ version: false, extensions: false });
  const c = decodeCertificate(bytes);
  assert.equal(c.version, 1);
  assert.deepEqual(c.extensions, []);
  assert.deepEqual(c.sans, []);
  assert.equal(pemBlocks(Buffer.from(bytes).toString('base64'))[0].label, 'CERTIFICATE');
});

test('x509: oidName, and OID arcs past 2^53', () => {
  assert.equal(oidName('1.2.840.10045.4.3.2'), 'ecdsa-with-SHA256');
  assert.equal(oidName('1.3.101.113'), 'Ed448');
  assert.equal(oidName('1.3.6.1.5.5.7.3.9'), 'OCSPSigning');
  assert.equal(oidName('1.2.3'), '1.2.3');
  assert.equal(decodeCertificate(syntheticCert()).extensions[4].oid, '2.25.' + (2n ** 64n - 1n));
});
