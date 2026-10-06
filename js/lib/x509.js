// X.509 certificates and PKCS#10 certificate requests, decoded here (nothing
// leaves the page): PEM unwrapping, a strict DER reader, and the parts people
// look at — names, dates, key, SANs and the common extensions. No signature
// or chain checking. Follows RFC 5280 (certificates) and RFC 2986 (CSRs).
//
// pemBlocks(text) -> [{ label, der }]
// parseDer(bytes) -> { tag, cls, constructed, start, headerLength, length, value, children? }
// decodeCertificate(der) / decodeCsr(der) -> plain objects (see each function)
// fingerprints(der) -> Promise<{ sha1, sha256 }>

// ---- OIDs ---------------------------------------------------------------------

export const OID_NAMES = {
  // signature algorithms
  '1.2.840.113549.1.1.4': 'md5WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'rsassaPss',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.14': 'sha224WithRSAEncryption',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.1': 'ecdsa-with-SHA224',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.2.840.10040.4.3': 'dsa-with-SHA1',
  '2.16.840.1.101.3.4.3.2': 'dsa-with-SHA256',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
  '1.2.643.7.1.1.3.2': 'GOST R 34.10-2012 (256)',
  // key algorithms (Ed25519/Ed448 are both)
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.10045.2.1': 'id-ecPublicKey',
  '1.2.840.10040.4.1': 'dsaEncryption',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  // hashes
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
  '2.16.840.1.101.3.4.2.4': 'sha224',
  // curves
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.33': 'P-224',
  '1.2.840.10045.3.1.1': 'P-192',
  '1.3.132.0.10': 'secp256k1',
  '1.3.36.3.3.2.8.1.1.7': 'brainpoolP256r1',
  '1.3.36.3.3.2.8.1.1.11': 'brainpoolP384r1',
  '1.3.36.3.3.2.8.1.1.13': 'brainpoolP512r1',
  // name attributes
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.15': 'businessCategory',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'GN',
  '2.5.4.43': 'initials',
  '2.5.4.44': 'generationQualifier',
  '2.5.4.46': 'dnQualifier',
  '2.5.4.65': 'pseudonym',
  '2.5.4.97': 'organizationIdentifier',
  '0.9.2342.19200300.100.1.1': 'UID',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '1.3.6.1.4.1.311.60.2.1.1': 'jurisdictionL',
  '1.3.6.1.4.1.311.60.2.1.2': 'jurisdictionST',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
  // CSR attributes
  '1.2.840.113549.1.9.2': 'unstructuredName',
  '1.2.840.113549.1.9.7': 'challengePassword',
  '1.2.840.113549.1.9.14': 'extensionRequest',
  // extensions
  '2.5.29.9': 'subjectDirectoryAttributes',
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.15': 'keyUsage',
  '2.5.29.16': 'privateKeyUsagePeriod',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.18': 'issuerAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.30': 'nameConstraints',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.33': 'policyMappings',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.36': 'policyConstraints',
  '2.5.29.37': 'extKeyUsage',
  '2.5.29.46': 'freshestCRL',
  '2.5.29.54': 'inhibitAnyPolicy',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',
  '1.3.6.1.5.5.7.1.11': 'subjectInfoAccess',
  '1.3.6.1.5.5.7.1.24': 'tlsFeature',
  '1.3.6.1.5.5.7.48.1.5': 'ocspNoCheck',
  '1.3.6.1.4.1.11129.2.4.2': 'ctPrecertificateSCTs',
  '1.3.6.1.4.1.11129.2.4.3': 'ctPrecertificatePoison',
  '2.16.840.1.113730.1.1': 'nsCertType',
  '2.16.840.1.113730.1.13': 'nsComment',
  // access methods
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'caIssuers',
  // extended key usages
  '2.5.29.37.0': 'anyExtendedKeyUsage',
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
  '1.3.6.1.5.5.7.3.17': 'ipsecIKE',
  '1.3.6.1.4.1.311.20.2.2': 'msSmartcardLogin',
  '1.3.6.1.4.1.311.10.3.12': 'msDocumentSigning',
  // other names
  '1.3.6.1.4.1.311.20.2.3': 'UPN',
  // certificate policies
  '2.5.29.32.0': 'anyPolicy',
  '2.23.140.1.1': 'extendedValidation',
  '2.23.140.1.2.1': 'domainValidated',
  '2.23.140.1.2.2': 'organizationValidated',
  '2.23.140.1.2.3': 'individualValidated',
  '1.3.6.1.5.5.7.2.1': 'cps',
  '1.3.6.1.5.5.7.2.2': 'userNotice',
};

// A short name for an OID, or the dotted OID itself.
export const oidName = (oid) => OID_NAMES[oid] || oid;

// ---- bytes ----------------------------------------------------------------------

// 'AB:CD:EF' (or with another separator).
export function toHex(bytes, sep = ':') {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(sep);
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('expected DER bytes (a Uint8Array)');
}

function fromBase64(s, what) {
  let t = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t) || t.length % 4 === 1) throw new Error(what + " isn't valid base64");
  t = t.replace(/=+$/, '');
  t += '='.repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---- PEM ------------------------------------------------------------------------

// Every -----BEGIN X----- ... -----END X----- block in the text, decoded. With
// no armour, the whole text as base64 or hex DER (label guessed from its shape).
export function pemBlocks(text) {
  const src = String(text);
  const out = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  for (let m; (m = re.exec(src));) {
    // Drop RFC 1421 headers (Proc-Type:, DEK-Info:) that encrypted keys carry.
    const body = m[2].split(/\r?\n/).filter((l) => !l.includes(':')).join('');
    out.push({ label: m[1], der: fromBase64(body, 'the ' + m[1] + ' block') });
  }
  if (out.length) return out;
  if (/-----BEGIN /.test(src)) throw new Error('a PEM block has no matching END line');
  const t = src.trim();
  if (!t) throw new Error('nothing to decode');
  const hex = t.replace(/^0x/i, '').replace(/[\s:]/g, '');
  let der;
  if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0 && /^3[01]/.test(hex)) {
    der = Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
  } else {
    try {
      der = fromBase64(t, 'the text');
    } catch (e) {
      throw new Error('no PEM block, base64 or hex DER found');
    }
  }
  let root;
  try {
    root = parseDer(der);
  } catch (e) {
    throw new Error('the text decodes, but not to DER: ' + e.message);
  }
  return [{ label: guessLabel(root), der }];
}

// What a parsed DER blob most likely is, from its outline.
function guessLabel(root) {
  const k = root.children || [];
  if (root.tag !== 16 || !k.length) return 'DER';
  const first = k[0].children || [];
  if (k.length === 2 && k[0].tag === 16 && k[1].tag === 3) return 'PUBLIC KEY';
  if (k.length === 3 && k[0].tag === 16 && k[2].tag === 3) {
    if (first[0] && first[0].cls === 'context' && first[0].tag === 0) return 'CERTIFICATE';
    if (first.length === 4 && first[0].tag === 2 && first[3].cls === 'context') return 'CERTIFICATE REQUEST';
    if (first.length >= 6 && first[0].tag === 2) return 'CERTIFICATE'; // v1, no [0] version
  }
  return 'DER';
}

// ---- DER ------------------------------------------------------------------------

const CLASSES = ['universal', 'application', 'context', 'private'];

// The single element `bytes` holds (trailing bytes are an error), children parsed
// for constructed types. Each node's `value` is a view of its contents.
export function parseDer(input) {
  const bytes = asBytes(input);
  if (!bytes.length) throw new Error('DER is empty');
  const node = readNode(bytes, 0, bytes.length, 0);
  const end = node.start + node.headerLength + node.length;
  if (end !== bytes.length) throw new Error('DER has ' + (bytes.length - end) + ' trailing bytes after the first element');
  return node;
}

function readNode(bytes, pos, end, depth) {
  if (depth > 64) throw new Error('DER nested too deeply');
  const start = pos;
  if (pos >= end) throw new Error('DER truncated at offset ' + pos + ': expected a tag');
  const id = bytes[pos++];
  const cls = CLASSES[id >> 6];
  const constructed = (id & 0x20) !== 0;
  let tag = id & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    do {
      if (pos >= end) throw new Error('DER truncated at offset ' + pos + ': in a multi-byte tag');
      if (tag > 0xffffff) throw new Error('DER tag number too large at offset ' + start);
      tag = tag * 128 + (bytes[pos] & 0x7f);
    } while (bytes[pos++] & 0x80);
  }
  if (pos >= end) throw new Error('DER truncated at offset ' + pos + ': expected a length');
  let length = bytes[pos++];
  if (length === 0x80) throw new Error('indefinite length at offset ' + start + ' (BER, not DER)');
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n > 4) throw new Error('DER length of ' + n + ' bytes at offset ' + start + ' is too large');
    if (pos + n > end) throw new Error('DER truncated at offset ' + pos + ': in a length');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + bytes[pos++];
  }
  const headerLength = pos - start;
  if (pos + length > end) {
    throw new Error('DER truncated: the element at offset ' + start + ' needs ' + length + ' bytes, ' + (end - pos) + ' remain');
  }
  const node = { tag, cls, constructed, start, headerLength, length, value: bytes.subarray(pos, pos + length) };
  if (constructed) {
    node.children = [];
    for (let p = pos; p < pos + length;) {
      const child = readNode(bytes, p, pos + length, depth + 1);
      node.children.push(child);
      p = child.start + child.headerLength + child.length;
    }
  }
  return node;
}

// The full encoding (header and contents) of a node.
const encoded = (node) => {
  const v = node.value;
  return new Uint8Array(v.buffer, v.byteOffset - node.headerLength, node.headerLength + node.length);
};

// The i-th child of a constructed node, or undefined.
const kid = (node, i) => node && node.children && node.children[i];

// Universal tags used below.
const T = { BOOLEAN: 1, INTEGER: 2, BIT_STRING: 3, OCTET_STRING: 4, NULL: 5, OID: 6, SEQUENCE: 16, SET: 17 };

function expect(node, tag, what, cls = 'universal') {
  if (!node || node.tag !== tag || node.cls !== cls || (node.constructed !== (tag === T.SEQUENCE || tag === T.SET))) throw new Error('malformed ' + what);
  return node;
}

function readOid(node) {
  const v = node.value;
  if (!v.length) throw new Error('empty OID');
  const arcs = [];
  let n = 0n;
  for (let i = 0; i < v.length; i++) {
    n = (n << 7n) | BigInt(v[i] & 0x7f);
    if (v[i] & 0x80) continue;
    if (!arcs.length) {
      const first = n < 40n ? 0n : n < 80n ? 1n : 2n;
      arcs.push(first, n - first * 40n);
    } else arcs.push(n);
    n = 0n;
  }
  return arcs.join('.');
}

// INTEGER contents as a BigInt (two's complement).
function readBigInt(node) {
  const v = node.value;
  let n = 0n;
  for (const b of v) n = (n << 8n) | BigInt(b);
  if (v.length && v[0] & 0x80) n -= 1n << BigInt(v.length * 8);
  return n;
}
const readInt = (node) => Number(readBigInt(node));

// BIT STRING contents without the unused-bits byte.
function bitBytes(node) {
  if (!node.value.length) throw new Error('empty BIT STRING');
  return node.value.subarray(1);
}

const latin1 = (v) => String.fromCharCode(...v);

// The text of any of the ASN.1 string types, or null for something else.
function readString(node) {
  if (node.cls !== 'universal') return null;
  const v = node.value;
  switch (node.tag) {
    case 12: return new TextDecoder().decode(v); // UTF8String
    case 18: case 19: case 22: case 26: case 20: case 21: case 25: case 27: return latin1(v);
    case 30: { // BMPString, UTF-16BE
      let s = '';
      for (let i = 0; i + 1 < v.length; i += 2) s += String.fromCharCode((v[i] << 8) | v[i + 1]);
      return s;
    }
    case 28: { // UniversalString, UTF-32BE
      let s = '';
      for (let i = 0; i + 3 < v.length; i += 4) {
        const cp = ((v[i] << 24) | (v[i + 1] << 16) | (v[i + 2] << 8) | v[i + 3]) >>> 0;
        s += cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd';
      }
      return s;
    }
    default: return null;
  }
}

// UTCTime (YYMMDDHHMM[SS]Z, 50-99 = 19xx) or GeneralizedTime (YYYYMMDDHHMM[SS[.f]]Z).
function readTime(node) {
  const s = latin1(node.value);
  const m = node.tag === 23 ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s)
    : node.tag === 24 ? /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:[.,](\d+))?Z$/.exec(s) : null;
  if (!m) throw new Error('unreadable time: ' + JSON.stringify(s));
  let year = +m[1];
  if (node.tag === 23) year += year < 50 ? 2000 : 1900;
  const ms = m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0;
  return new Date(Date.UTC(year, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), ms));
}

// ---- names ----------------------------------------------------------------------

// RFC 4514 escaping of one attribute value.
function escapeDn(s) {
  return s.replace(/[\\,+"<>;]/g, '\\$&').replace(/^[ #]/, '\\$&').replace(/ $/, '\\ ').replace(/\0/g, '\\00');
}

// Name -> { dn, attrs }: attrs in encoding order, dn most-specific first
// (CN=..., O=..., C=...), as RFC 4514 and `openssl -nameopt RFC2253` print it.
function readName(node) {
  expect(node, T.SEQUENCE, 'name');
  const attrs = [];
  const rdns = [];
  for (const rdn of node.children) {
    expect(rdn, T.SET, 'name (RDN)');
    const parts = [];
    for (const atv of rdn.children) {
      expect(atv, T.SEQUENCE, 'name attribute');
      const oid = readOid(expect(atv.children[0], T.OID, 'name attribute type'));
      const valueNode = atv.children[1];
      if (!valueNode) throw new Error('malformed name attribute: no value');
      const text = readString(valueNode);
      const value = text ?? '#' + toHex(encoded(valueNode), '').toLowerCase();
      attrs.push({ oid, name: oidName(oid), value });
      parts.push(oidName(oid) + '=' + (text === null ? value : escapeDn(text)));
    }
    rdns.push(parts.join('+'));
  }
  return { dn: rdns.reverse().join(', '), attrs };
}

// ---- general names ---------------------------------------------------------------

function ipText(v) {
  if (v.length === 4) return v.join('.');
  if (v.length === 16) {
    const g = [];
    for (let i = 0; i < 16; i += 2) g.push((v[i] << 8) | v[i + 1]);
    // RFC 5952: drop the longest run (two or more) of zero groups.
    let best = -1, bestLen = 1;
    for (let i = 0; i < 8;) {
      if (g[i]) { i++; continue; }
      let j = i;
      while (j < 8 && !g[j]) j++;
      if (j - i > bestLen) { best = i; bestLen = j - i; }
      i = j;
    }
    const h = g.map((x) => x.toString(16));
    if (best < 0) return h.join(':');
    return h.slice(0, best).join(':') + '::' + h.slice(best + bestLen).join(':');
  }
  // Name constraints: address followed by mask.
  if (v.length === 8 || v.length === 32) {
    const half = v.length / 2;
    const bits = Array.from(v.subarray(half), (b) => b.toString(2).replace(/0+$/, '').length).reduce((a, b) => a + b, 0);
    return ipText(v.subarray(0, half)) + '/' + bits;
  }
  return toHex(v);
}

const GN_TYPES = ['otherName', 'email', 'DNS', 'x400Address', 'DirName', 'ediPartyName', 'URI', 'IP', 'RID'];

// GeneralName -> { type, value }.
function readGeneralName(node) {
  const type = node.cls === 'context' ? GN_TYPES[node.tag] : undefined;
  switch (type) {
    case 'email': case 'DNS': case 'URI': return { type, value: latin1(node.value) };
    case 'IP': return { type, value: ipText(node.value) };
    case 'RID': return { type, value: readOid(node) };
    case 'DirName': return { type, value: readName(node.children[0]).dn };
    case 'otherName': {
      const oid = readOid(expect(node.children[0], T.OID, 'otherName'));
      const inner = node.children[1] && node.children[1].children && node.children[1].children[0];
      const text = inner ? readString(inner) : null;
      return { type, value: oidName(oid) + ':' + (text ?? (inner ? toHex(inner.value) : '')) };
    }
    default: return { type: type || 'unknown', value: toHex(node.value) };
  }
}

const readGeneralNames = (node) => expect(node, T.SEQUENCE, 'general names').children.map(readGeneralName);

// ---- algorithms and keys ---------------------------------------------------------

function readAlgorithm(node) {
  expect(node, T.SEQUENCE, 'algorithm identifier');
  const oid = readOid(expect(node.children[0], T.OID, 'algorithm identifier'));
  return { oid, name: oidName(oid), params: node.children[1] };
}

const CURVE_BITS = { 'P-192': 192, 'P-224': 224, 'P-256': 256, 'P-384': 384, 'P-521': 521, secp256k1: 256, brainpoolP256r1: 256, brainpoolP384r1: 384, brainpoolP512r1: 512 };

// Bit length of an unsigned big-endian integer.
function bitLength(v) {
  let i = 0;
  while (i < v.length && v[i] === 0) i++;
  if (i === v.length) return 0;
  return (v.length - i - 1) * 8 + v[i].toString(2).length;
}

// SubjectPublicKeyInfo -> { algorithm, oid, bits, curve?, exponent?, modulus?, spki }.
function readPublicKey(node) {
  expect(node, T.SEQUENCE, 'public key info');
  const alg = readAlgorithm(node.children[0]);
  const key = bitBytes(expect(node.children[1], T.BIT_STRING, 'public key'));
  const out = { algorithm: alg.name, oid: alg.oid, bits: null, spki: encoded(node) };
  switch (alg.oid) {
    case '1.2.840.113549.1.1.1':
    case '1.2.840.113549.1.1.10': {
      out.algorithm = alg.oid.endsWith('.1') ? 'RSA' : 'RSA-PSS';
      const rsa = parseDer(key);
      const [n, e] = expect(rsa, T.SEQUENCE, 'RSA public key').children;
      expect(n, T.INTEGER, 'RSA modulus');
      expect(e, T.INTEGER, 'RSA exponent');
      out.bits = bitLength(n.value);
      out.exponent = readInt(e);
      out.modulus = toHex(n.value[0] === 0 ? n.value.subarray(1) : n.value);
      break;
    }
    case '1.2.840.10045.2.1': {
      out.algorithm = 'EC';
      if (alg.params && alg.params.tag === T.OID) {
        const c = readOid(alg.params);
        out.curve = oidName(c);
        out.bits = CURVE_BITS[out.curve] || null;
      } else out.curve = 'explicit';
      // Uncompressed point 04||X||Y, compressed 02/03||X.
      if (!out.bits && key.length) out.bits = (key[0] === 4 ? (key.length - 1) / 2 : key.length - 1) * 8;
      break;
    }
    case '1.3.101.112': out.bits = 256; break;
    case '1.3.101.113': out.bits = 456; break;
    case '1.3.101.110': out.bits = 256; break;
    case '1.3.101.111': out.bits = 448; break;
    case '1.2.840.10040.4.1': {
      out.algorithm = 'DSA';
      const p = alg.params && alg.params.children && alg.params.children[0];
      if (p) out.bits = bitLength(p.value);
      break;
    }
  }
  return out;
}

// ---- extensions -----------------------------------------------------------------

const KEY_USAGES = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'];

// Each known extension's DER (the OCTET STRING contents) -> a plain value.
const EXT_DECODERS = {
  subjectAltName: readGeneralNames,
  issuerAltName: readGeneralNames,
  basicConstraints(n) {
    const out = { ca: false, pathLen: null };
    for (const c of expect(n, T.SEQUENCE, 'basicConstraints').children) {
      if (c.tag === T.BOOLEAN) out.ca = c.value[0] !== 0;
      else if (c.tag === T.INTEGER) out.pathLen = readInt(c);
    }
    return out;
  },
  keyUsage(n) {
    const bits = bitBytes(expect(n, T.BIT_STRING, 'keyUsage'));
    return KEY_USAGES.filter((_, i) => (bits[i >> 3] >> (7 - (i & 7))) & 1);
  },
  extKeyUsage: (n) => expect(n, T.SEQUENCE, 'extKeyUsage').children.map((c) => oidName(readOid(c))),
  subjectKeyIdentifier: (n) => toHex(expect(n, T.OCTET_STRING, 'subjectKeyIdentifier').value),
  authorityKeyIdentifier(n) {
    const out = {};
    for (const c of expect(n, T.SEQUENCE, 'authorityKeyIdentifier').children) {
      if (c.cls !== 'context') continue;
      if (c.tag === 0) out.keyid = toHex(c.value);
      else if (c.tag === 1) out.issuer = c.children.map(readGeneralName);
      else if (c.tag === 2) out.serial = toHex(c.value);
    }
    return out;
  },
  authorityInfoAccess: readAccess,
  subjectInfoAccess: readAccess,
  cRLDistributionPoints: readDistributionPoints,
  freshestCRL: readDistributionPoints,
  certificatePolicies(n) {
    return expect(n, T.SEQUENCE, 'certificatePolicies').children.map((p) => {
      const oid = readOid(p.children[0]);
      const cps = [];
      for (const q of (p.children[1] && p.children[1].children) || []) {
        if (readOid(q.children[0]) === '1.3.6.1.5.5.7.2.1' && q.children[1]) cps.push(latin1(q.children[1].value));
      }
      return { oid, name: oidName(oid), cps };
    });
  },
  nsComment: (n) => readString(n),
};

// AuthorityInfoAccess -> { ocsp: [url], caIssuers: [url], other: ['method - value'] }.
function readAccess(n) {
  const out = { ocsp: [], caIssuers: [], other: [] };
  for (const ad of expect(n, T.SEQUENCE, 'authorityInfoAccess').children) {
    const method = oidName(readOid(ad.children[0]));
    const gn = readGeneralName(ad.children[1]);
    if (method === 'OCSP' && gn.type === 'URI') out.ocsp.push(gn.value);
    else if (method === 'caIssuers' && gn.type === 'URI') out.caIssuers.push(gn.value);
    else out.other.push(method + ' - ' + gn.type + ':' + gn.value);
  }
  return out;
}

// CRLDistributionPoints -> the full names: URLs as is, anything else as 'TYPE:value'.
function readDistributionPoints(n) {
  const out = [];
  for (const dp of expect(n, T.SEQUENCE, 'cRLDistributionPoints').children) {
    const name = dp.children.find((c) => c.cls === 'context' && c.tag === 0);
    const full = name && name.children.find((c) => c.cls === 'context' && c.tag === 0);
    for (const g of (full && full.children) || []) {
      const gn = readGeneralName(g);
      out.push(gn.type === 'URI' ? gn.value : gn.type + ':' + gn.value);
    }
  }
  return out;
}

// Extensions (a SEQUENCE of Extension) -> [{ oid, name, critical, value }];
// unknown or unreadable values stay hex (the latter with `error`).
function readExtensions(node) {
  return expect(node, T.SEQUENCE, 'extensions').children.map((ext) => {
    expect(ext, T.SEQUENCE, 'extension');
    const oid = readOid(expect(ext.children[0], T.OID, 'extension id'));
    const critical = ext.children.length > 2 && ext.children[1].tag === T.BOOLEAN && ext.children[1].value[0] !== 0;
    const raw = expect(ext.children[ext.children.length - 1], T.OCTET_STRING, 'extension value').value;
    const name = oidName(oid);
    const out = { oid, name, critical, value: toHex(raw) };
    if (EXT_DECODERS[name]) {
      try {
        out.value = EXT_DECODERS[name](parseDer(raw));
      } catch (e) {
        out.error = e.constructor === Error ? e.message : 'malformed ' + name;
      }
    }
    return out;
  });
}

// 'DNS:example.com', 'IP:1.2.3.4', ... from the subjectAltName extension.
function sanList(extensions) {
  const san = extensions.find((e) => e.name === 'subjectAltName' && Array.isArray(e.value));
  return san ? san.value.map((g) => g.type + ':' + g.value) : [];
}

// ---- certificates -------------------------------------------------------------------

// Bytes, or text holding a PEM/base64/hex block of the wanted kind.
function derFrom(input, labels) {
  if (typeof input !== 'string') return asBytes(input);
  const blocks = pemBlocks(input);
  return (blocks.find((b) => labels.includes(b.label)) || blocks[0]).der;
}

// Serial numbers print without the sign byte DER adds before a high bit.
function serialHex(node) {
  const v = node.value;
  return toHex(v.length > 1 && v[0] === 0 && v[1] & 0x80 ? v.subarray(1) : v);
}

// A certificate (DER bytes, or PEM text) -> { version, serialNumber, signatureAlgorithm,
// issuer, subject, validity, publicKey, extensions, sans, selfSigned, tbs, signature }.
export function decodeCertificate(input) {
  const der = derFrom(input, ['CERTIFICATE', 'X509 CERTIFICATE', 'TRUSTED CERTIFICATE']);
  const root = parseDer(der);
  if (guessLabel(root) === 'CERTIFICATE REQUEST') throw new Error('this is a certificate request (CSR), not a certificate');
  const what = 'certificate: expected SEQUENCE { tbsCertificate, signatureAlgorithm, signature }';
  if (root.tag !== T.SEQUENCE || !root.children || root.children.length < 3) throw new Error('not an X.509 ' + what);
  const [tbsNode, sigAlgNode, sigNode] = root.children;
  expect(tbsNode, T.SEQUENCE, what);
  expect(sigNode, T.BIT_STRING, what);
  const f = tbsNode.children.slice();
  let version = 1;
  if (f[0] && f[0].cls === 'context' && f[0].tag === 0) version = readInt(expect(kid(f.shift(), 0), T.INTEGER, 'version')) + 1;
  const serial = expect(f.shift(), T.INTEGER, 'serial number');
  f.shift(); // the inner signature algorithm repeats the outer one
  const issuer = readName(f.shift());
  const validityNode = expect(f.shift(), T.SEQUENCE, 'validity');
  if (validityNode.children.length !== 2) throw new Error('malformed validity');
  const subject = readName(f.shift());
  const publicKey = readPublicKey(f.shift());
  const extNode = f.find((n) => n.cls === 'context' && n.tag === 3);
  const extensions = extNode ? readExtensions(kid(extNode, 0)) : [];
  const { oid, name } = readAlgorithm(sigAlgNode);
  return {
    version,
    serialNumber: serialHex(serial),
    signatureAlgorithm: { oid, name },
    issuer,
    subject,
    validity: { notBefore: readTime(validityNode.children[0]), notAfter: readTime(validityNode.children[1]) },
    publicKey,
    extensions,
    sans: sanList(extensions),
    selfSigned: issuer.dn === subject.dn,
    tbs: encoded(tbsNode),
    signature: bitBytes(sigNode),
  };
}

// A PKCS#10 request (DER bytes, or PEM text) -> { version, subject, publicKey,
// attributes: [{ oid, name, value }], extensions (from extensionRequest), sans,
// signatureAlgorithm, tbs, signature }.
export function decodeCsr(input) {
  const der = derFrom(input, ['CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST']);
  const root = parseDer(der);
  if (guessLabel(root) === 'CERTIFICATE') throw new Error('this is a certificate, not a certificate request');
  const what = 'certificate request: expected SEQUENCE { certificationRequestInfo, signatureAlgorithm, signature }';
  if (root.tag !== T.SEQUENCE || !root.children || root.children.length < 3) throw new Error('not a PKCS#10 ' + what);
  const [info, sigAlgNode, sigNode] = root.children;
  expect(info, T.SEQUENCE, what);
  expect(sigNode, T.BIT_STRING, what);
  const [ver, subjectNode, spkiNode, attrNode] = info.children;
  const attributes = [];
  let extensions = [];
  for (const a of (attrNode && attrNode.cls === 'context' && attrNode.children) || []) {
    expect(a, T.SEQUENCE, 'attribute');
    const oid = readOid(expect(a.children[0], T.OID, 'attribute type'));
    const values = expect(a.children[1], T.SET, 'attribute values').children;
    let value;
    if (oid === '1.2.840.113549.1.9.14' && values[0]) value = extensions = readExtensions(values[0]);
    else value = values.length === 1 ? readString(values[0]) ?? toHex(values[0].value) : values.map((v) => readString(v) ?? toHex(v.value));
    attributes.push({ oid, name: oidName(oid), value });
  }
  const { oid, name } = readAlgorithm(sigAlgNode);
  return {
    version: readInt(expect(ver, T.INTEGER, 'version')) + 1,
    subject: readName(subjectNode),
    publicKey: readPublicKey(spkiNode),
    attributes,
    extensions,
    sans: sanList(extensions),
    signatureAlgorithm: { oid, name },
    tbs: encoded(info),
    signature: bitBytes(sigNode),
  };
}

// SHA-1 and SHA-256 of the DER, as 'AB:CD:...' (what browsers and openssl show).
export async function fingerprints(input) {
  const der = derFrom(input, ['CERTIFICATE']);
  const digest = async (alg) => toHex(new Uint8Array(await globalThis.crypto.subtle.digest(alg, der)));
  return { sha1: await digest('SHA-1'), sha256: await digest('SHA-256') };
}
