/**
 * Writes the OpenAPI document to the client so it can generate typed API calls.
 *   npm run openapi:export            → ../client/src/api/openapi.json
 *   npm run openapi:export -- out.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import '../src/app.js'; // registers every route
import { buildOpenApiDocument } from '../src/openapi/document.js';

const target = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..', '..', 'client', 'src', 'api', 'openapi.json'));
const doc = buildOpenApiDocument();
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`OpenAPI written to ${target} (${Object.keys(doc.paths as object).length} paths)`);
