#!/usr/bin/env bash
set -euo pipefail

# ─── Arrakis Local Setup Script ─────────────────────────────────────────────
# Creates a k3d cluster, installs CRDs, builds Helm deps, and starts all
# three components (operator, API, dashboard) in parallel.
#
# Usage:
#   chmod +x setup.sh
#   ./setup.sh              # full setup (cluster + all services)
#   ./setup.sh --skip-cluster  # skip cluster creation (if cluster already exists)
#   ./setup.sh --skip-auth     # run API without GitHub OAuth (default)
#
# Prerequisites: node 22+, docker, kubectl, helm 3, k3d
# ─────────────────────────────────────────────────────────────────────────────

CLUSTER_NAME="arrakis"
SKIP_CLUSTER=false
SKIP_AUTH=true
LOG_DIR=".arrakis-logs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[arrakis]${NC} $1"; }
ok()   { echo -e "${GREEN}[  ok  ]${NC} $1"; }
warn() { echo -e "${YELLOW}[ warn ]${NC} $1"; }
fail() { echo -e "${RED}[failed]${NC} $1"; exit 1; }

# ─── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --skip-cluster) SKIP_CLUSTER=true ;;
    --skip-auth)    SKIP_AUTH=true ;;
    --with-auth)    SKIP_AUTH=false ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

# ─── Preflight checks ───────────────────────────────────────────────────────
log "Checking prerequisites..."

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    fail "$1 is required but not installed. $2"
  fi
}

check_cmd node      "Install from https://nodejs.org (v22+ required)"
check_cmd docker    "Install from https://docs.docker.com/get-docker"
check_cmd kubectl   "Install from https://kubernetes.io/docs/tasks/tools"
check_cmd helm      "Install from https://helm.sh/docs/intro/install"
check_cmd k3d       "Install from https://k3d.io"

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node.js 22+ is required (found $(node -v))"
fi

if ! docker info &>/dev/null; then
  fail "Docker daemon is not running"
fi

ok "All prerequisites satisfied (node $(node -v), helm $(helm version --short 2>/dev/null | head -1), k3d $(k3d version 2>/dev/null | head -1 | awk '{print $3}'))"

# ─── Create cluster ─────────────────────────────────────────────────────────
if [ "$SKIP_CLUSTER" = false ]; then
  if k3d cluster list 2>/dev/null | grep -q "$CLUSTER_NAME"; then
    warn "Cluster '$CLUSTER_NAME' already exists, reusing it"
  else
    log "Creating k3d cluster '${CLUSTER_NAME}' with port 80 mapped..."
    k3d cluster create "$CLUSTER_NAME" --port "80:80@loadbalancer" --wait
    ok "Cluster created"
  fi
else
  log "Skipping cluster creation (--skip-cluster)"
fi

# Wait for cluster to be ready
log "Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=60s &>/dev/null || true
ok "Cluster is ready"

# ─── Apply CRD and RBAC ─────────────────────────────────────────────────────
log "Applying CRD and RBAC..."
kubectl apply -f config/crd.yaml
kubectl apply -f config/rbac.yaml
ok "CRD (stores.arrakis.io) and RBAC applied"

# ─── Build Helm dependencies ────────────────────────────────────────────────
log "Building Helm chart dependencies..."
(cd helm-charts/woocommerce && helm dependency build 2>/dev/null)
ok "Helm dependencies built"

# ─── Install npm dependencies ────────────────────────────────────────────────
log "Installing npm dependencies for all three projects..."
(cd operator && npm install --silent 2>/dev/null) &
(cd api && npm install --silent 2>/dev/null) &
(cd dashboard && npm install --silent 2>/dev/null) &
wait
ok "npm dependencies installed"

# ─── Start services ─────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

log "Starting operator (logs: ${LOG_DIR}/operator.log)..."
(cd operator && SKIP_LEADER_ELECTION=true npx ts-node src/index.ts) > "${LOG_DIR}/operator.log" 2>&1 &
OPERATOR_PID=$!

log "Starting API on :8080 (logs: ${LOG_DIR}/api.log)..."
if [ "$SKIP_AUTH" = true ]; then
  (cd api && SKIP_AUTH=true npx ts-node src/server.ts) > "${LOG_DIR}/api.log" 2>&1 &
else
  (cd api && npx ts-node src/server.ts) > "${LOG_DIR}/api.log" 2>&1 &
fi
API_PID=$!

log "Starting dashboard on :5173 (logs: ${LOG_DIR}/dashboard.log)..."
(cd dashboard && npm run dev -- --host 2>/dev/null) > "${LOG_DIR}/dashboard.log" 2>&1 &
DASH_PID=$!

# ─── Wait for services to be ready ──────────────────────────────────────────
log "Waiting for services to start..."
sleep 3

# Check if processes are still alive
for name_pid in "operator:$OPERATOR_PID" "api:$API_PID" "dashboard:$DASH_PID"; do
  name="${name_pid%%:*}"
  pid="${name_pid##*:}"
  if ! kill -0 "$pid" 2>/dev/null; then
    fail "$name failed to start. Check ${LOG_DIR}/${name}.log"
  fi
done

# Wait for API health
for i in $(seq 1 20); do
  if curl -sf http://localhost:8080/health &>/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf http://localhost:8080/health &>/dev/null; then
  warn "API health check not responding yet, but process is running. Check ${LOG_DIR}/api.log"
fi

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Arrakis is running!${NC}"
echo ""
echo -e "  ${BOLD}Dashboard${NC}   http://localhost:5173"
echo -e "  ${BOLD}API${NC}         http://localhost:8080"
echo -e "  ${BOLD}API Docs${NC}    http://localhost:8080/api/docs"
echo -e "  ${BOLD}Health${NC}      http://localhost:8080/health"
echo ""
echo -e "  ${BOLD}Logs${NC}        ${LOG_DIR}/operator.log"
echo -e "              ${LOG_DIR}/api.log"
echo -e "              ${LOG_DIR}/dashboard.log"
echo ""
echo -e "  ${BOLD}PIDs${NC}        operator=${OPERATOR_PID}  api=${API_PID}  dashboard=${DASH_PID}"
echo ""
echo -e "  ${YELLOW}To stop:${NC}    kill $OPERATOR_PID $API_PID $DASH_PID"
echo -e "  ${YELLOW}To teardown:${NC} k3d cluster delete ${CLUSTER_NAME}"
echo ""
echo -e "  Create your first store:"
echo -e "  ${CYAN}curl -X POST http://localhost:8080/api/stores -H 'Content-Type: application/json' -d '{\"engine\":\"woocommerce\",\"template\":\"fashion\"}'${NC}"
echo ""

# Keep script alive so child processes don't get orphaned
wait
