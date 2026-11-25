#!/usr/bin/env node
// Simulates a monitoring alert through Flagsmith's Feature Health Webhook provider (created by `make seed`).
//
//   node devkit/health.mjs alert   [flag] [environment]   (make alert)    mark a flag UNHEALTHY
//   node devkit/health.mjs recover [flag] [environment]   (make recover)  mark it healthy again
//
// This is the request a tool such as Grafana or Prometheus Alertmanager would send. FlagLens shows the result.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDotenv } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (!existsSync(envPath)) throw new Error('No .env: run make up && make seed first.');
const env = parseDotenv(readFileSync(envPath, 'utf8'));
const url = process.env.FLAGSMITH_HEALTH_WEBHOOK_URL || env.FLAGSMITH_HEALTH_WEBHOOK_URL;
if (!url) throw new Error('FLAGSMITH_HEALTH_WEBHOOK_URL is missing from .env: re-run make seed.');

const [action = 'alert', feature = 'new_checkout', environment = 'Production'] = process.argv.slice(2);
const unhealthy = action === 'alert';
const event = {
  feature,
  environment,
  status: unhealthy ? 'unhealthy' : 'healthy',
  ...(unhealthy && {
    reason: {
      text_blocks: [{ title: 'Checkout errors', text: 'Error rate 4.2% (threshold 1%) since the last change' }],
      url_blocks: [{ title: 'Dashboard', url: 'https://grafana.example.com/d/checkout' }],
    },
  }),
};
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
if (!res.ok) throw new Error(`Flagsmith answered HTTP ${res.status}`);
console.log(`${feature} is now ${unhealthy ? 'UNHEALTHY' : 'healthy'} in ${environment} (Flagsmith Feature Health). FlagLens picks it up on its next refresh.`);
