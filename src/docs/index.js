import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
let spec = null;

export function getOpenApiSpec() {
  if (!spec) {
    try {
      const raw = readFileSync(resolve(__dirname, 'openapi.json'), 'utf-8');
      spec = JSON.parse(raw);
      logger.info('[docs] OpenAPI spec loaded');
    } catch (err) {
      logger.warn({ err }, '[docs] Failed to load OpenAPI spec');
      spec = { openapi: '3.0.3', info: { title: 'HORNET API', version: '1.0.0' }, paths: {} };
    }
  }
  return spec;
}

export function docsRoutes(router) {
  router.get('/openapi.json', (_req, res) => {
    res.json(getOpenApiSpec());
  });

  router.get('/docs', (_req, res) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HORNET VPN API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;
    res.type('html').send(html);
  });
}
