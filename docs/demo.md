# Arrakis Platform — Live Demo

Deployed on AWS EC2 (ap-southeast-2) with k3s, accessible at `arrakis.ruskaruma.me`.

Arrakis is a multi-tenant e-commerce platform that provisions fully isolated WooCommerce stores on Kubernetes with a single click. Each store runs in its own namespace with dedicated database, storage, networking policies, and resource quotas.

---

## 1. Sign In with GitHub

Navigate to the dashboard and sign in using your GitHub account. Arrakis uses GitHub OAuth for authentication — each user gets their own isolated set of stores.

![Login Page](screenshots/01-login.png)

---

## 2. Dashboard — Getting Started

After signing in, you land on the main dashboard. If you have no stores yet, you'll see the empty state with a prompt to create your first store.

Click the **"Create Store"** button in the top-right corner or the one in the empty state to get started.

![Empty State](screenshots/02-empty-state.png)

---

## 3. Create a New Store

The **Create Store** modal lets you configure your new store:

- **Store Name** — Give your store a name (e.g. "Gada Electronics", "My Fashion Store")
- **Engine** — Select the e-commerce engine. Currently WooCommerce is supported, with MedusaJS planned.
- **Template** — Choose a store template that pre-seeds your store with themed products:
  - **General** — Arrakis Spice Blend
  - **Fashion** — Desert Silk Robe, Stillsuit Jacket, Fremen Sandals
  - **Food** — Spice Melange Tea, Arrakeen Coffee Beans, Sietch Bread Mix
  - **Electronics** — Holtzman Shield Generator, Ornithopter Navigation Module, Thumper Device
  - **Beauty** — Spice Essence Perfume, Desert Rose Skin Oil, Sietch Mineral Soap
  - **Sports** — Sandworm Rider Harness, Fremen Combat Training Kit, Desert Running Sandals
  - **Books** — The Collected Sayings of Muad'Dib, Ecology of Dune, The Orange Catholic Bible

Click **"Create Store"** to begin provisioning.

![Create Store Modal](screenshots/03-create-store.png)

---

## 4. Watch It Provision

Once created, the store goes through a 5-step provisioning pipeline — all automated by the Arrakis operator:

1. **Creating namespace and isolation policies** — Dedicated Kubernetes namespace with NetworkPolicies, ResourceQuota, and LimitRange
2. **Installing WordPress via Helm** — Full WordPress + MariaDB stack deployed via Helm chart
3. **Waiting for pods** — All containers must be running and healthy
4. **Configuring WooCommerce via WP-CLI** — Activates WooCommerce, sets up permalinks, seeds products from your chosen template, generates API keys
5. **Verifying store health** — HTTP health check and product count verification

The store card shows real-time progress with phase updates. You can click **"Manage Store"** to see detailed events as they happen.

![Provisioning](screenshots/04-provisioning.png)

---

## 5. Real-Time Event Timeline

Click **"Manage Store"** on any store card to open the detailed store view. The **Event Timeline** shows every Kubernetes event in real-time:

- Volume provisioning and binding
- Container image pulls
- Pod scheduling and startup
- Helm release installation
- Phase transitions (Provisioning → Configuring → Verifying → Ready)

This gives full visibility into what's happening inside the cluster during provisioning.

![Events Timeline](screenshots/05-events.png)

---

## 6. Store is Ready

When all 5 steps complete, the store enters the **Ready** phase. The store card now shows:

- **Store URL** — Click to visit your live WooCommerce storefront
- **WP-Admin** — Direct link to the WordPress admin panel
- **Phase badge** — Green "Ready" indicator
- **Revision** — Current Helm revision number
- **Manage Store** — Opens the full detail view with events, metrics, and management actions

![Store Ready](screenshots/06-store-ready.png)

---

## 7. Visit Your Live Store

Click the **store URL** to open your fully functional WooCommerce storefront. The store is live and accessible at its own subdomain (e.g. `s86c8ba38.arrakis.ruskaruma.me`).

The storefront comes pre-configured with:
- Your chosen template products
- Shop page set as homepage
- WooCommerce with Cash on Delivery enabled
- Clean permalinks
- Default WordPress content removed

![Storefront](screenshots/07-storefront.png)

---

## 8. Manage Products

From the store detail page, you can view and manage products:

- **View products** — See all products seeded from your template
- **Add a product** — Use the "Add Product" form to create new products with a name and price
- **Delete products** — Remove products you no longer need

Products are managed via the WooCommerce REST API — changes appear immediately on the live storefront.

![Products](screenshots/08-products.png)

---

## 9. Full Store Management

The **Store Detail** page is your command center for each store. It includes:

### Store Info
- Store ID, engine, template, phase, creation time, URL

### Revision History
- View all Helm revisions with timestamps and status
- **Rollback** to any previous revision with one click

### Upgrade
- Upgrade the store to a new version or apply custom Helm values

### Retry
- If a store fails during provisioning, retry with a single click

### Event Timeline
- Full chronological view of all Kubernetes events

### Quick Commands
- Pre-built `kubectl` and `helm` commands for debugging:
  - `kubectl get pods -n store-<id>`
  - `kubectl logs -f deploy/<id>-wordpress -n store-<id>`
  - `helm status <id> -n store-<id>`

### API Endpoints
- Complete list of REST API endpoints for the store:
  - `GET /api/stores/:id` — Store details
  - `GET /api/stores/:id/events` — K8s events
  - `GET /api/stores/:id/metrics` — Resource usage
  - `GET /api/stores/:id/credentials` — WP-Admin credentials
  - `GET /api/stores/:id/revisions` — Revision history
  - `GET /api/stores/:id/products` — Product list
  - `POST /api/stores/:id/products` — Create product
  - `POST /api/stores/:id/upgrade` — Upgrade store
  - `POST /api/stores/:id/rollback` — Rollback store
  - `POST /api/stores/:id/retry` — Retry failed store
  - `DELETE /api/stores/:id` — Delete store

### Delete Store
- Permanently delete a store — tears down the Helm release, removes the namespace, and cleans up all resources

![Store Detail](screenshots/09-store-detail.png)
