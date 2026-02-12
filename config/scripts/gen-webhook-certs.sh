#!/usr/bin/env bash
# Generate self-signed TLS certificates for the admission webhook.
# Usage: ./gen-webhook-certs.sh
# Creates a K8s Secret with the TLS cert/key and patches the webhook caBundle.

set -euo pipefail

SERVICE_NAME="arrakis-webhook"
NAMESPACE="default"
SECRET_NAME="arrakis-webhook-tls"
TMPDIR=$(mktemp -d)

# Generate CA
openssl genrsa -out "${TMPDIR}/ca.key" 2048
openssl req -x509 -new -nodes -key "${TMPDIR}/ca.key" -sha256 -days 3650 \
  -out "${TMPDIR}/ca.crt" -subj "/CN=arrakis-webhook-ca"

# Generate server cert
openssl genrsa -out "${TMPDIR}/tls.key" 2048
cat > "${TMPDIR}/csr.conf" <<EOF
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name
prompt = no

[req_distinguished_name]
CN = ${SERVICE_NAME}.${NAMESPACE}.svc

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${SERVICE_NAME}
DNS.2 = ${SERVICE_NAME}.${NAMESPACE}
DNS.3 = ${SERVICE_NAME}.${NAMESPACE}.svc
DNS.4 = ${SERVICE_NAME}.${NAMESPACE}.svc.cluster.local
EOF

openssl req -new -key "${TMPDIR}/tls.key" -out "${TMPDIR}/tls.csr" -config "${TMPDIR}/csr.conf"
openssl x509 -req -in "${TMPDIR}/tls.csr" -CA "${TMPDIR}/ca.crt" -CAkey "${TMPDIR}/ca.key" \
  -CAcreateserial -out "${TMPDIR}/tls.crt" -days 3650 -extensions v3_req -extfile "${TMPDIR}/csr.conf"

# Create K8s Secret
kubectl create secret tls "${SECRET_NAME}" \
  --cert="${TMPDIR}/tls.crt" \
  --key="${TMPDIR}/tls.key" \
  --namespace="${NAMESPACE}" \
  --dry-run=client -o yaml | kubectl apply -f -

# Patch webhook with CA bundle
CA_BUNDLE=$(base64 < "${TMPDIR}/ca.crt" | tr -d '\n')
kubectl patch validatingwebhookconfiguration arrakis-store-validator \
  --type='json' \
  -p="[{\"op\": \"replace\", \"path\": \"/webhooks/0/clientConfig/caBundle\", \"value\": \"${CA_BUNDLE}\"}]"

echo "Webhook TLS configured. CA bundle injected into ValidatingWebhookConfiguration."

rm -rf "${TMPDIR}"
