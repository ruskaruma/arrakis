export const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Arrakis Store Provisioning API',
    version: '1.0.0',
    description: 'REST API for managing multi-tenant WooCommerce stores on Kubernetes.',
  },
  servers: [{ url: '/api', description: 'API base' }],
  paths: {
    '/stores': {
      post: {
        summary: 'Create a new store',
        tags: ['Stores'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['engine'],
                properties: {
                  engine: { type: 'string', enum: ['woocommerce', 'medusajs'] },
                  storeName: { type: 'string', maxLength: 64 },
                  template: { type: 'string', enum: ['general', 'fashion', 'food', 'electronics', 'beauty', 'sports', 'books'], default: 'general' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Store created' },
          '400': { description: 'Invalid input' },
          '429': { description: 'Rate limited or max stores reached' },
          '501': { description: 'Engine not yet available' },
        },
      },
      get: {
        summary: 'List stores for authenticated user',
        tags: ['Stores'],
        responses: {
          '200': { description: 'Array of stores' },
        },
      },
    },
    '/stores/{id}': {
      get: {
        summary: 'Get store by ID',
        tags: ['Stores'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Store details' },
          '404': { description: 'Store not found' },
        },
      },
      delete: {
        summary: 'Delete a store',
        tags: ['Stores'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': { description: 'Store deletion initiated' },
          '404': { description: 'Store not found' },
        },
      },
    },
    '/stores/{id}/retry': {
      post: {
        summary: 'Retry a failed store provisioning',
        tags: ['Stores'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Retry initiated' },
          '400': { description: 'Store is not in Failed state' },
          '403': { description: 'Not your store' },
          '404': { description: 'Store not found' },
        },
      },
    },
    '/stores/{id}/upgrade': {
      post: {
        summary: 'Upgrade a store (CRD-driven Helm upgrade)',
        tags: ['Stores'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  version: { type: 'string', maxLength: 32, description: 'Target version for the upgrade' },
                  helmValues: { type: 'object', description: 'Additional Helm values to set' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Upgrade initiated' },
          '400': { description: 'Invalid input or store not Ready' },
          '403': { description: 'Not your store' },
          '404': { description: 'Store not found' },
        },
      },
    },
    '/stores/{id}/rollback': {
      post: {
        summary: 'Rollback a store to a previous Helm revision',
        tags: ['Stores'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  revision: { type: 'integer', minimum: 1, description: 'Target revision number. Omit to rollback to previous revision.' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Rollback initiated' },
          '400': { description: 'Invalid state or revision' },
          '403': { description: 'Not your store' },
          '404': { description: 'Store not found' },
        },
      },
    },
    '/stores/{id}/revisions': {
      get: {
        summary: 'Get Helm revision history for a store',
        tags: ['Stores'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Array of Helm revisions',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      revision: { type: 'integer' },
                      updated: { type: 'string' },
                      status: { type: 'string' },
                      chart: { type: 'string' },
                      app_version: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          '403': { description: 'Not your store' },
          '404': { description: 'Store not found' },
        },
      },
    },
    '/stores/{id}/credentials': {
      get: {
        summary: 'Get WP-Admin credentials for a store',
        tags: ['Stores'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Credentials',
            content: { 'application/json': { schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } } } } },
          },
          '403': { description: 'Not your store' },
          '404': { description: 'Credentials not available' },
        },
      },
    },
    '/stores/{id}/events': {
      get: {
        summary: 'Get Kubernetes events for a store',
        tags: ['Events'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Array of events' } },
      },
    },
    '/stores/{id}/metrics': {
      get: {
        summary: 'Get resource metrics for a store',
        tags: ['Metrics'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Resource usage (CPU, memory, storage, pods)' } },
      },
    },
    '/stores/{id}/products': {
      get: {
        summary: 'List products for a store',
        tags: ['Products'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Array of WooCommerce products' } },
      },
      post: {
        summary: 'Create a product',
        tags: ['Products'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  regular_price: { type: 'string', default: '0' },
                  images: { type: 'array', items: { type: 'object', properties: { src: { type: 'string' } } } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Product created' }, '400': { description: 'Invalid input' } },
      },
    },
    '/stores/{id}/products/{productId}': {
      delete: {
        summary: 'Delete a product',
        tags: ['Products'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'productId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '204': { description: 'Product deleted' } },
      },
    },
    '/events': {
      get: {
        summary: 'Get all events across stores',
        tags: ['Events'],
        responses: { '200': { description: 'Array of events' } },
      },
    },
    '/audit': {
      get: {
        summary: 'Get audit log of recent actions',
        tags: ['Audit'],
        responses: {
          '200': {
            description: 'Array of audit entries',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      timestamp: { type: 'string', format: 'date-time' },
                      action: { type: 'string' },
                      storeId: { type: 'string' },
                      ip: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/stats': {
      get: {
        summary: 'Get aggregate store statistics',
        tags: ['Stats'],
        responses: {
          '200': {
            description: 'Stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer' },
                    byPhase: { type: 'object' },
                    avgProvisionMs: { type: 'number', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Store: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          engine: { type: 'string' },
          storeName: { type: 'string', nullable: true },
          template: { type: 'string' },
          owner: { type: 'string', nullable: true },
          phase: { type: 'string', enum: ['Pending', 'Provisioning', 'Configuring', 'Verifying', 'Ready', 'Failed', 'Deleting', 'Upgrading', 'RollingBack'] },
          version: { type: 'string', nullable: true },
          helmRevision: { type: 'integer', nullable: true },
          lastUpgradedAt: { type: 'string', format: 'date-time', nullable: true },
          url: { type: 'string', nullable: true },
          message: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          startedAt: { type: 'string', format: 'date-time', nullable: true },
          readyAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
    securitySchemes: {
      githubOAuth: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: '/auth/github', tokenUrl: '/auth/github/callback', scopes: {} } } },
    },
  },
  security: [{ githubOAuth: [] }],
};
