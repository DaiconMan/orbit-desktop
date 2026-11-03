#!/bin/sh
# Create a self-signed "Orbit Desktop Dev" code-signing identity in your login keychain (once).
# build.sh then signs with it, so macOS keeps the app's permissions (calendar, audio capture,
# notifications) across rebuilds. The certificate never leaves this Mac and needs no trust settings.
set -eu
if security find-identity -p codesigning 2>/dev/null | grep -q '"Orbit Desktop Dev"'; then
  echo "already present"; exit 0
fi
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
cat > "$D/cfg.cnf" <<'CNF'
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=Orbit Desktop Dev
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -keyout "$D/key.pem" -out "$D/cert.pem" -days 3650 -config "$D/cfg.cnf" 2>/dev/null
P=$(/usr/bin/openssl rand -hex 12)
/usr/bin/openssl pkcs12 -export -inkey "$D/key.pem" -in "$D/cert.pem" -out "$D/id.p12" -passout "pass:$P" -name "Orbit Desktop Dev"
security import "$D/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$P" -T /usr/bin/codesign
echo "created: Orbit Desktop Dev"
