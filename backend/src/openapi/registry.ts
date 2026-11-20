import type { Role } from '@prisma/client';
import type { z } from 'zod';

export type RouteDoc = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Full Express path, e.g. /api/rooms/:id */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth?: 'required' | 'optional' | 'refresh-cookie';
  roles?: readonly Role[];
  request?: { params?: z.ZodType; query?: z.ZodType; body?: z.ZodType };
  status?: number;
  response?: z.ZodType;
  /** For non-JSON success bodies (e.g. the OpenAPI document itself). */
  responseDescription?: string;
  /** Binary success body (e.g. audio), sent by the handler itself. */
  rawResponse?: { contentType: string; description: string };
  errors?: readonly number[];
};

const routes: RouteDoc[] = [];

export function registerRouteDoc(doc: RouteDoc): void {
  const duplicate = routes.find((r) => r.method === doc.method && r.path === doc.path);
  if (duplicate) throw new Error(`Route registered twice: ${doc.method.toUpperCase()} ${doc.path}`);
  routes.push(doc);
}

export function registeredRoutes(): readonly RouteDoc[] {
  return routes;
}
