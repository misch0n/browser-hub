#!/bin/sh
# Regenerates the X.509 fixtures for tests/x509.test.mjs (OpenSSL 3.0+).
# Keys are thrown away; only the public PEM files are kept. The expected
# values in the test were copied from `openssl x509 -noout -text` output, so
# regenerating means updating them (new keys -> new fingerprints and key ids).
set -eu
cd "$(dirname "$0")"
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

# `openssl ca` rather than `openssl x509 -req`: it takes fixed -startdate/-enddate.
mkdir "$W/new"
cat > "$W/ca.cnf" <<CNF
[ca]
default_ca = fixture
[fixture]
dir = $W
database = $W/index.txt
new_certs_dir = $W/new
serial = $W/serial
policy = anything
preserve = yes
email_in_dn = yes
unique_subject = no
copy_extensions = none
[anything]
C = optional
ST = optional
L = optional
O = optional
OU = optional
CN = optional
emailAddress = optional

[rsa_leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectKeyIdentifier = hash
subjectAltName = DNS:example.test, DNS:www.example.test, DNS:*.api.example.test, IP:192.0.2.10, IP:2001:db8::1, email:admin@example.test

[ec_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash

[ec_leaf]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth, codeSigning, emailProtection, timeStamping, OCSPSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
authorityInfoAccess = OCSP;URI:http://ocsp.example.test, caIssuers;URI:http://ca.example.test/ca.crt
crlDistributionPoints = URI:http://crl.example.test/ca.crl
certificatePolicies = 2.23.140.1.2.1, 1.3.6.1.4.1.55555.1.2
subjectAltName = DNS:leaf.example.test, URI:https://leaf.example.test/id, IP:10.1.2.3

[ed_leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
subjectAltName = DNS:ed25519.example.test
CNF

ca() { # serial ext key csr out startdate enddate [extra args]
  echo "$1" > "$W/serial"; : > "$W/index.txt"
  ext=$2; key=$3; csr=$4; out=$5; start=$6; end=$7; shift 7
  openssl ca -batch -config "$W/ca.cnf" -extensions "$ext" -keyfile "$key" -in "$csr" \
    -startdate "$start" -enddate "$end" -notext -out "$W/out.pem" "$@" 2>/dev/null
  openssl x509 -in "$W/out.pem" -out "$out"
}

# 1. Self-signed RSA-2048, a full subject, server SANs (DNS, IPv4, IPv6, email).
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$W/rsa.key" 2>/dev/null
openssl req -new -key "$W/rsa.key" -out "$W/rsa.csr" \
  -subj '/C=DE/ST=Berlin/L=Berlin/O=Example GmbH/OU=Platform Team/CN=example.test/emailAddress=admin@example.test'
ca 5A17C0FFEE0123 rsa_leaf "$W/rsa.key" "$W/rsa.csr" rsa-selfsigned.pem 20250101000000Z 20350101000000Z -selfsign -md sha256

# 2. EC P-384 CA (self-signed) and a P-256 leaf it signs (AKI/SKI, AIA, CRL DP, policies).
#    The leaf's notAfter is past 2049, so it is a GeneralizedTime.
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-384 -out "$W/ca.key"
openssl req -new -key "$W/ca.key" -out "$W/ca.csr" -subj '/C=US/O=Example Trust/CN=Example Test Root CA'
ca 01 ec_ca "$W/ca.key" "$W/ca.csr" ec-ca.pem 20240601120000Z 20440601120000Z -selfsign -md sha384
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$W/leaf.key"
openssl req -new -key "$W/leaf.key" -out "$W/leaf.csr" -subj '/C=US/O=Example Leaf Inc./CN=leaf.example.test'
ca 00A1B2C3D4E5F60718 ec_leaf "$W/ca.key" "$W/leaf.csr" ec-leaf.pem 20250315083000Z 20510315083000Z -cert ec-ca.pem -md sha384

# 3. Self-signed Ed25519.
openssl genpkey -algorithm ED25519 -out "$W/ed.key"
openssl req -new -key "$W/ed.key" -out "$W/ed.csr" -subj '/O=Example/CN=ed25519.example.test'
ca 2A ed_leaf "$W/ed.key" "$W/ed.csr" ed25519.pem 20250701000000Z 20270701000000Z -selfsign

# 4. A CSR (RSA-3072) with SANs and usages in its extensionRequest, plus a challengePassword.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$W/csr.key" 2>/dev/null
cat > "$W/req.cnf" <<CNF
[req]
prompt = no
distinguished_name = dn
attributes = attrs
req_extensions = exts
[dn]
C = GB
O = Example Ltd
CN = csr.example.test
[attrs]
challengePassword = fixture-secret
[exts]
subjectAltName = DNS:csr.example.test, DNS:alt.example.test, IP:198.51.100.7, IP:fe80::1:2
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
CNF
openssl req -new -config "$W/req.cnf" -key "$W/csr.key" -sha256 -out csr.pem
