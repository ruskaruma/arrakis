# Arrakis

Multi-tenant store provisioning on Kubernetes. Create fully-configured WooCommerce stores with a single API call. Each store gets its own namespace with resource isolation, networking policies, and automated cleanup.

**Features:** GitHub OAuth, per-user store ownership, store naming, 4 product templates (fashion/food/electronics/general), HPOS, validating admission webhook, Prometheus metrics, live provisioning timer, MedusaJS architecture (Q2 2026).

## Prerequisites

- Node.js 22+ (required for @kubernetes/client-node v1.4.0 ESM support)
- Docker
- kubectl
- Helm 3
- k3d (local) or k3s (production)
- GitHub OAuth App (for authentication — or set `SKIP_AUTH=true` for local dev)

## Local Setup (k3d)

### 1. Create cluster

```bash
k3d cluster create arrakis --port "80:80@loadbalancer"
```

### 2. Apply CRD and RBAC

```bash
kubectl apply -f config/crd.yaml
kubectl apply -f config/rbac.yaml
```

### 3. Build Helm dependencies

```bash
cd helm-charts/woocommerce
helm dependency build
cd ../..
```

### 4. Start the operator

```bash
cd operator
npm install
npx ts-node src/index.ts
```

### 5. Start the API (separate terminal)

```bash
cd api
npm install

# For local dev without OAuth:
SKIP_AUTH=true npx ts-node src/server.ts

# With GitHub OAuth:
# Create a .env file with:
#   GITHUB_CLIENT_ID=<your-client-id>
#   GITHUB_CLIENT_SECRET=<your-client-secret>
#   SESSION_SECRET=<random-string>
#   DASHBOARD_URL=http://localhost:5173
#   GITHUB_CALLBACK_URL=http://localhost:8080/auth/github/callback
npx ts-node src/server.ts
```

API runs on port 8080.

### 6. Start the dashboard (separate terminal)

```bash
cd dashboard
npm install
npm run dev
```

Dashboard runs on port 5173. Open http://localhost:5173.

## Production Setup (k3s VPS)

### 1. Install k3s

```bash
curl -sfL https://get.k3s.io | sh -
```

### 2. Install nginx ingress controller

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace
```

### 3. Install cert-manager for TLS

```bash
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true
```

### 4. Install Longhorn for distributed storage

```bash
helm repo add longhorn https://charts.longhorn.io
helm install longhorn longhorn/longhorn -n longhorn-system --create-namespace
```

### 5. Apply CRD and RBAC

```bash
kubectl apply -f config/crd.yaml
kubectl apply -f config/rbac.yaml
```

### 6. Start operator with production values

The operator uses `helm-charts/woocommerce/values-prod.yaml` which configures:
- nginx ingress (instead of traefik)
- cert-manager TLS with Let's Encrypt
- Longhorn distributed storage (instead of local-path)
- 2 WordPress replicas with PodDisruptionBudget
- Pod anti-affinity for node spread
- Hardened container security (runAsNonRoot, drop ALL capabilities)
- 10Gi storage per store (instead of 1Gi)

Point the operator at the prod values file and set your domain:

```bash
cd operator
npm install
HELM_VALUES=../helm-charts/woocommerce/values-prod.yaml npx ts-node src/index.ts
```

For production DNS, configure a wildcard A record (`*.yourdomain.com`) pointing to the VPS IP. The operator sets each store's hostname to `{storeId}.yourdomain.com`.

## Usage

### Create a store

**Via dashboard:** Open http://localhost:5173, click "Create Store", enter a name, choose a template, and create.

**Via API:**

```bash
curl -X POST http://localhost:8080/api/stores \
  -H "Content-Type: application/json" \
  -d '{"engine": "woocommerce", "storeName": "My Fashion Store", "template": "fashion"}'
```

Response:

```json
{
  "id": "s86c8ba38",
  "engine": "woocommerce",
  "storeName": "My Fashion Store",
  "template": "fashion",
  "owner": "12345678",
  "phase": "Pending",
  "url": null,
  "message": null,
  "createdAt": "2026-02-11T15:00:00Z",
  "startedAt": null,
  "readyAt": null
}
```

Templates: `general` (default), `fashion`, `food`, `electronics`. Each seeds different themed products.

The store progresses through: Pending -> Provisioning -> Configuring -> Verifying -> Ready. This takes 1-3 minutes depending on cluster resources.

### Access a store

Once the phase is `Ready`, the store is live at the URL in the response:

```
http://s1a2b3c4d.127.0.0.1.nip.io/shop
```

The store comes pre-configured with:
- WooCommerce plugin installed and activated
- HPOS (High-Performance Order Storage) enabled
- Template products seeded (e.g., fashion: Desert Silk Robe, Stillsuit Jacket, Fremen Sandals)
- Cash on Delivery payment method enabled
- Shop page set as homepage

### Place an order

1. Go to the store URL (`/shop`)
2. Add "Arrakis Spice Blend" to cart
3. Proceed to checkout
4. Fill in billing details (any test data)
5. Select "Cash on Delivery"
6. Place order

Or via WP REST API:

```bash
STORE_URL="http://s1a2b3c4d.127.0.0.1.nip.io"

# Get product ID
PRODUCT_ID=$(curl -s "$STORE_URL/wp-json/wc/v3/products?search=Arrakis" \
  -u "user:$(kubectl exec -n store-s1a2b3c4d deploy/store-s1a2b3c4d-wordpress -- wp user meta get 1 woocommerce_api_key --allow-root 2>/dev/null)" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Place order
curl -X POST "$STORE_URL/wp-json/wc/v3/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "payment_method": "cod",
    "billing": {"first_name":"Test","last_name":"User","email":"test@test.com","address_1":"123 St","city":"City","postcode":"12345","country":"US"},
    "line_items": [{"product_id": '"$PRODUCT_ID"', "quantity": 1}]
  }'
```

### List stores

```bash
curl http://localhost:8080/api/stores
```

### Delete a store

```bash
curl -X DELETE http://localhost:8080/api/stores/s1a2b3c4d
```

Or via `kubectl delete store s1a2b3c4d`. The finalizer ensures the namespace, Helm release, and all resources are cleaned up before the CRD is removed.

### View events

```bash
# All events
curl http://localhost:8080/api/events

# Events for a specific store
curl http://localhost:8080/api/stores/s1a2b3c4d/events
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /auth/github | Initiate GitHub OAuth flow |
| GET | /auth/github/callback | OAuth callback |
| GET | /auth/me | Get current user |
| POST | /auth/logout | Logout |
| POST | /api/stores | Create a store (rate-limited: 10/15min, max 10 per user) |
| GET | /api/stores | List authenticated user's stores |
| GET | /api/stores/:id | Get a single store |
| DELETE | /api/stores/:id | Delete a store |
| GET | /api/stores/:id/events | Kubernetes events for a store's namespace |
| GET | /api/events | All events across stores |
| GET | /health | API health check |

All `/api/*` routes require authentication (GitHub OAuth session or `SKIP_AUTH=true`). MedusaJS engine returns 501 (Q2 2026 roadmap).

## Project Structure

```
operator/src/       Kubernetes operator (1,164 lines — reconciler, webhook, WP-CLI, Helm, metrics)
api/src/            REST API (437 lines — Express.js, GitHub OAuth, store routes)
dashboard/src/      React dashboard (892 lines — store cards, template picker, activity log)
config/             CRD, RBAC, HPA, webhook, deployment manifests
helm-charts/
  woocommerce/      Bitnami WordPress subchart (values-local + values-prod)
  medusajs/         MedusaJS skeleton chart (PostgreSQL + Redis)
```

**Total:** 25 TypeScript source files, 2,493 lines. 19 YAML config files.

## Upgrades & Rollback

### Upgrade a store's WordPress version

Update the chart version in `helm-charts/woocommerce/Chart.yaml`, then:

```bash
helm upgrade {storeId} helm-charts/woocommerce \
  --namespace store-{storeId} \
  --values helm-charts/woocommerce/values-local.yaml \
  --wait --timeout 10m
```

The `--wait` flag ensures the upgrade only succeeds if all pods become ready with the new version. If the upgrade fails, the old ReplicaSet remains active — no data is lost.

### Rollback to a previous version

```bash
# Rollback to previous revision
helm rollback {storeId} --namespace store-{storeId} --timeout 5m

# Rollback to a specific revision
helm rollback {storeId} 2 --namespace store-{storeId} --timeout 5m

# View revision history
helm history {storeId} --namespace store-{storeId}
```

The operator's `HelmManager.rollback()` method exposes this programmatically.

### Horizontal Pod Autoscaling

HPA manifests are provided in `config/hpa-operator.yaml` and `config/hpa-api.yaml`:

```bash
kubectl apply -f config/hpa-operator.yaml
kubectl apply -f config/hpa-api.yaml
```

The operator scales 1-3 replicas on CPU (70%) and memory (80%). The API scales 1-5 replicas on CPU (70%). See `ARCHITECTURE.md` for scaling constraints (single-leader operator pattern).

## Tech Stack

- **Operator**: TypeScript, @kubernetes/client-node v1.4.0, prom-client
- **API**: Express.js, passport-github2, express-session, express-rate-limit
- **Dashboard**: React 18, Vite 7, Tailwind CSS 4
- **Helm**: Chart API v2, Bitnami WordPress 28.x
- **Cluster**: k3d (local), k3s (production)
- **DNS**: nip.io wildcard (local), real domain (production)
- **Deployed**: AWS EC2 c7i-flex.large, k3s, 54.206.104.15
