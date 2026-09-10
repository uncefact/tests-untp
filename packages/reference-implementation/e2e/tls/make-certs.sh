#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

umask 077

rm -f ca.crt ca.key leaf.crt leaf.key leaf.csr ca.srl leaf.ext

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -nodes \
  -keyout ca.key \
  -out ca.crt \
  -days 3650 \
  -subj '/CN=UNTP E2E Test CA' \
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:1' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'

openssl req \
  -newkey rsa:2048 \
  -sha256 \
  -nodes \
  -keyout leaf.key \
  -out leaf.csr \
  -subj '/CN=vckit.e2e.internal'

cat > leaf.ext <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:vckit.e2e.internal
EOF

openssl x509 \
  -req \
  -sha256 \
  -in leaf.csr \
  -CA ca.crt \
  -CAkey ca.key \
  -CAcreateserial \
  -out leaf.crt \
  -days 3650 \
  -extfile leaf.ext

chmod 644 ca.crt leaf.crt leaf.key
rm -f leaf.csr ca.srl leaf.ext
