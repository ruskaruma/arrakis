import https from 'https';
import http from 'http';
import fs from 'fs';
import { log } from './logger';

const VALID_ENGINES = ['woocommerce', 'medusajs'];
const VALID_TEMPLATES = ['general', 'fashion', 'food', 'electronics'];
const MAX_STORE_NAME_LENGTH = 64;
const BLOCKED_ENGINES = ['medusajs'];

interface AdmissionReview {
  apiVersion: string;
  kind: string;
  request: {
    uid: string;
    operation: string;
    object: {
      spec: {
        engine?: string;
        storeName?: string;
        template?: string;
        owner?: string;
      };
    };
  };
}

interface ValidationResult {
  allowed: boolean;
  message?: string;
}

function validateStore(review: AdmissionReview): ValidationResult {
  const { operation, object } = review.request;
  const spec = object?.spec;

  if (!spec) {
    return { allowed: false, message: 'spec is required' };
  }

  if (operation === 'CREATE' || operation === 'UPDATE') {
    if (!spec.engine || !VALID_ENGINES.includes(spec.engine)) {
      return { allowed: false, message: `engine must be one of: ${VALID_ENGINES.join(', ')}` };
    }

    if (BLOCKED_ENGINES.includes(spec.engine)) {
      return { allowed: false, message: `${spec.engine} engine is not yet available` };
    }

    if (spec.template && !VALID_TEMPLATES.includes(spec.template)) {
      return { allowed: false, message: `template must be one of: ${VALID_TEMPLATES.join(', ')}` };
    }

    if (spec.storeName && spec.storeName.length > MAX_STORE_NAME_LENGTH) {
      return { allowed: false, message: `storeName must be ${MAX_STORE_NAME_LENGTH} characters or fewer` };
    }

    if (spec.storeName && !/^[\w\s\-'.]+$/.test(spec.storeName)) {
      return { allowed: false, message: 'storeName contains invalid characters' };
    }
  }

  return { allowed: true };
}

function buildResponse(uid: string, result: ValidationResult) {
  return {
    apiVersion: 'admission.k8s.io/v1',
    kind: 'AdmissionReview',
    response: {
      uid,
      allowed: result.allowed,
      ...(result.message && {
        status: {
          code: result.allowed ? 200 : 403,
          message: result.message,
        },
      }),
    },
  };
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (req.method !== 'POST' || req.url !== '/validate') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', (chunk: string) => { body += chunk; });
  req.on('end', () => {
    try {
      const review: AdmissionReview = JSON.parse(body);
      const result = validateStore(review);

      if (!result.allowed) {
        log.warn('webhook.denied', result.message || 'Validation failed', {
          uid: review.request.uid,
          operation: review.request.operation,
          engine: review.request.object?.spec?.engine,
        });
      }

      const response = buildResponse(review.request.uid, result);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err: any) {
      log.error('webhook.error', `Failed to process admission review: ${err.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        apiVersion: 'admission.k8s.io/v1',
        kind: 'AdmissionReview',
        response: { uid: '', allowed: false, status: { code: 400, message: 'Invalid request body' } },
      }));
    }
  });
}

export function startWebhookServer(port: number = 9443): http.Server | https.Server {
  const certPath = process.env.WEBHOOK_CERT_PATH || '/etc/webhook/certs';
  const tlsCert = `${certPath}/tls.crt`;
  const tlsKey = `${certPath}/tls.key`;

  if (fs.existsSync(tlsCert) && fs.existsSync(tlsKey)) {
    const server = https.createServer(
      { cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) },
      handleRequest,
    );
    server.listen(port, () => {
      log.info('webhook.start', `Admission webhook (HTTPS) on :${port}`);
    });
    return server;
  }

  // Fallback to HTTP for local development
  const server = http.createServer(handleRequest);
  server.listen(port, () => {
    log.info('webhook.start', `Admission webhook (HTTP, dev-only) on :${port}`);
  });
  return server;
}

export { validateStore, buildResponse };
