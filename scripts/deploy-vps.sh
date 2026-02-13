#!/bin/bash
set -e

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
REPO_DIR=/home/ubuntu/arrakis

echo "=== Arrakis VPS Deploy ==="
echo "Public IP: $PUBLIC_IP"
echo ""

# 1. Install Node.js 20
echo ">>> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install k3s
echo ">>> Installing k3s..."
curl -sfL https://get.k3s.io | sh -
echo ">>> Waiting for k3s..."
sudo kubectl wait --for=condition=Ready node --all --timeout=120s
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc

# 3. Install Helm
echo ">>> Installing Helm..."
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 4. Build operator
echo ">>> Building operator..."
cd $REPO_DIR/operator
npm install
npx tsc

# 5. Build API
echo ">>> Building API..."
cd $REPO_DIR/api
npm install
npx tsc

# 6. Build dashboard
echo ">>> Building dashboard..."
cd $REPO_DIR/dashboard
npm install
VITE_API_URL=http://$PUBLIC_IP:8080 npx vite build

# 7. Install serve for dashboard
echo ">>> Installing serve..."
sudo npm install -g serve

# 8. Apply CRD and RBAC
echo ">>> Applying CRD and RBAC..."
kubectl apply -f $REPO_DIR/config/crd.yaml
kubectl apply -f $REPO_DIR/config/rbac.yaml

# 9. Update Helm chart dependencies
echo ">>> Updating Helm dependencies..."
cd $REPO_DIR/helm-charts/woocommerce
helm dependency update 2>/dev/null || true

# 10. Create systemd services
echo ">>> Creating systemd services..."

sudo tee /etc/systemd/system/arrakis-operator.service > /dev/null <<EOF
[Unit]
Description=Arrakis Operator
After=k3s.service
Requires=k3s.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/arrakis/operator
Environment=KUBECONFIG=/home/ubuntu/.kube/config
Environment=SKIP_LEADER_ELECTION=1
Environment=STORE_BASE_DOMAIN=${PUBLIC_IP}.nip.io
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

SESSION_SECRET=$(openssl rand -hex 32)

sudo tee /etc/systemd/system/arrakis-api.service > /dev/null <<EOF
[Unit]
Description=Arrakis API
After=k3s.service
Requires=k3s.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/arrakis/api
Environment=KUBECONFIG=/home/ubuntu/.kube/config
Environment=PORT=8080
Environment=SKIP_AUTH=true
Environment=DASHBOARD_URL=http://${PUBLIC_IP}:3000
Environment=SESSION_SECRET=${SESSION_SECRET}
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/arrakis-dashboard.service > /dev/null <<EOF
[Unit]
Description=Arrakis Dashboard
After=arrakis-api.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/arrakis/dashboard
ExecStart=/usr/bin/serve -s dist -l 3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 11. Start services
echo ">>> Starting services..."
sudo systemctl daemon-reload
sudo systemctl enable arrakis-operator arrakis-api arrakis-dashboard
sudo systemctl start arrakis-operator arrakis-api arrakis-dashboard

# 12. Open firewall ports
echo ">>> Configuring firewall..."
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 8080 -j ACCEPT

echo ""
echo "==============================="
echo "  DEPLOY COMPLETE"
echo "==============================="
echo "Dashboard:  http://$PUBLIC_IP:3000"
echo "API:        http://$PUBLIC_IP:8080"
echo "API Docs:   http://$PUBLIC_IP:8080/api/docs"
echo "Stores:     http://<store-id>.$PUBLIC_IP.nip.io"
echo ""
echo "IMPORTANT: Open these ports in your AWS Security Group:"
echo "  - TCP 80   (store ingress)"
echo "  - TCP 443  (store ingress HTTPS)"
echo "  - TCP 3000 (dashboard)"
echo "  - TCP 8080 (API)"
