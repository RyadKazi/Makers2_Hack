/**
 * Builds the OpenAPI 3.1 document from the route registry. Zod 4 emits JSON
 * Schema 2020-12, which OpenAPI 3.1 uses natively; schemas carrying
 * `.meta({ id })` become reusable components.
 */
import { z } from 'zod';
import { registeredRoutes, type RouteDoc } from './registry.js';
import { ErrorResponseSchema } from './schemas.js';

type Json = Record<string, unknown>;

const SAFE_INT = 9007199254740991;

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Validation error or malformed request',
  401: 'Missing, invalid or expired credentials',
  403: 'Authenticated but not allowed',
  404: 'Not found',
  409: 'Conflict',
  429: 'Too many requests',
};

/** Walks a JSON schema: moves $defs into `components`, rewrites refs and drops noise. */
function normalise(node: unknown, components: Json): unknown {
  if (Array.isArray(node)) return node.map((n) => normalise(n, components));
  if (node === null || typeof node !== 'object') return node;

  const obj = { ...(node as Json) };
  delete obj.$schema;

  if (obj.$defs && typeof obj.$defs === 'object') {
    for (const [name, def] of Object.entries(obj.$defs as Json)) {
      if (!(name in components)) components[name] = normalise(def, components);
    }
    delete obj.$defs;
  }
  if (typeof obj.$ref === 'string') obj.$ref = obj.$ref.replace('#/$defs/', '#/components/schemas/');
  // Zod's exhaustive ISO regex and safe-integer bounds add nothing for API readers.
  if (obj.format === 'date-time') delete obj.pattern;
  if (obj.minimum === -SAFE_INT) delete obj.minimum;
  if (obj.maximum === SAFE_INT) delete obj.maximum;

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') obj[key] = normalise(value, components);
  }
  return obj;
}

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output', components: Json): Json {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' });
  return normalise(raw, components) as Json;
}

/** Turns an object schema into OpenAPI parameters. */
function parameters(schema: z.ZodType | undefined, location: 'path' | 'query', components: Json): Json[] {
  if (!schema) return [];
  const json = toJsonSchema(schema, 'input', components);
  const properties = (json.properties ?? {}) as Record<string, Json>;
  const required = new Set((json.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, prop]) => {
    const { description, ...rest } = prop;
    return {
      name,
      in: location,
      required: location === 'path' || required.has(name),
      ...(description ? { description } : {}),
      schema: rest,
    };
  });
}

function errorStatuses(route: RouteDoc): number[] {
  const set = new Set<number>(route.errors ?? []);
  if (route.request) set.add(400);
  if (route.auth === 'required' || route.auth === 'refresh-cookie') set.add(401);
  if (route.roles?.length) set.add(403);
  return [...set].sort();
}

function operation(route: RouteDoc, components: Json): Json {
  const status = route.status ?? (route.response || route.responseDescription || route.rawResponse ? 200 : 204);
  const responses: Json = {
    [status]: {
      description: route.rawResponse?.description ?? route.responseDescription ?? STATUS_TEXT[status] ?? 'Success',
      ...(route.response ? { content: { 'application/json': { schema: toJsonSchema(route.response, 'output', components) } } } : {}),
      ...(route.rawResponse ? { content: { [route.rawResponse.contentType]: { schema: { type: 'string', format: 'binary' } } } } : {}),
    },
  };
  for (const code of errorStatuses(route)) {
    responses[code] = {
      description: STATUS_TEXT[code] ?? 'Error',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
    };
  }

  const description = [route.description, route.roles?.length ? `**Roles:** ${route.roles.join(', ')}` : null].filter(Boolean).join('\n\n');

  return {
    tags: [route.tag],
    summary: route.summary,
    ...(description ? { description } : {}),
    operationId: `${route.method}${route.path.replace(/[/:{}-]+(\w)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
    ...(route.auth === 'required'
      ? { security: [{ bearerAuth: [] }] }
      : route.auth === 'optional'
        ? { security: [{ bearerAuth: [] }, {}] }
        : route.auth === 'refresh-cookie'
          ? { security: [{ refreshCookie: [] }] }
          : {}),
    parameters: [...parameters(route.request?.params, 'path', components), ...parameters(route.request?.query, 'query', components)],
    ...(route.request?.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: toJsonSchema(route.request.body, 'input', components) } } } }
      : {}),
    responses,
  };
}

export function buildOpenApiDocument(): Json {
  const components: Json = {};
  toJsonSchema(ErrorResponseSchema, 'output', components);
  components.ErrorResponse ??= toJsonSchema(ErrorResponseSchema, 'output', {});

  const paths: Record<string, Json> = {};
  const tags = new Set<string>();
  for (const route of registeredRoutes()) {
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][route.method] = operation(route, components);
    tags.add(route.tag);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'accesU API',
      version: '0.2.0',
      description:
        'Accessible indoor navigation for an Algerian university campus.\n\n' +
        'Coordinates are local campus metres (x → east, y → north), GeoJSON uses [x, y]. ' +
        'Times are ISO-8601 UTC; the campus runs on Africa/Algiers (UTC+1). ' +
        'Labels follow `?lang=ar|fr|en` or `Accept-Language` (default fr).\n\n' +
        'Live updates: Socket.io namespace `/live` (see README).',
    },
    servers: [{ url: '/' }],
    tags: [...tags].map((name) => ({ name })),
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token from /api/auth/login, /register or /refresh' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: 'cw_rt', description: 'httpOnly refresh token cookie, path /api/auth' },
      },
    },
  };
}
