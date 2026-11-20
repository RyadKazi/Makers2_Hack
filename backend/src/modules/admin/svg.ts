import sanitizeHtml from 'sanitize-html';

const MAX_SVG_BYTES = 500 * 1024;

const SVG_TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'title',
  'desc',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'symbol',
  'use',
] as const;

const SVG_ATTRIBUTES = [
  'id',
  'class',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'dx',
  'dy',
  'd',
  'points',
  'width',
  'height',
  'viewBox',
  'preserveAspectRatio',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'patternUnits',
  'patternTransform',
  'patternContentUnits',
  'text-anchor',
  'dominant-baseline',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'word-spacing',
  'xmlns',
  'version',
] as const;

export function sanitizeFloorSvg(input: string): string {
  const trimmed = input.trim();
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_SVG_BYTES) {
    throw new Error('SVG content exceeds the 500 KB limit');
  }

  if (/<!DOCTYPE/i.test(trimmed) || /<!ENTITY/i.test(trimmed)) {
    throw new Error('SVG document declarations and entities are not allowed');
  }
  if (
    /<(?:script|foreignObject|iframe|object|embed|image)\b/i.test(trimmed)
    || /\s(?:on[a-z]+|href|xlink:href|style)\s*=/i.test(trimmed)
    || /(?:javascript|vbscript)\s*:|url\s*\(|data:text\/html/i.test(trimmed)
  ) {
    throw new Error('SVG contains unsupported or unsafe content');
  }

  const sanitized = sanitizeHtml(trimmed, {
    allowedTags: [...SVG_TAGS],
    allowedAttributes: Object.fromEntries(
      SVG_TAGS.map((tag) => [tag, [...SVG_ATTRIBUTES]]),
    ),
    allowedSchemes: [],
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
    parser: {
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
    },
  }).trim();

  const svgMatches = [...sanitized.matchAll(/<svg\b/gi)];
  const closingMatches = [...sanitized.matchAll(/<\/svg>/gi)];
  if (
    !/^<svg\b/i.test(sanitized)
    || svgMatches.length !== 1
    || closingMatches.length !== 1
    || !/<\/svg>\s*$/.test(sanitized)
  ) {
    throw new Error('Content must contain exactly one valid SVG document');
  }

  if (/<(?:script|foreignObject|iframe|object|embed|image)\b/i.test(sanitized)) {
    throw new Error('SVG contains unsupported active content');
  }
  if (/\s(?:on[a-z]+|href|xlink:href|style)\s*=?/i.test(sanitized)) {
    throw new Error('SVG contains unsupported attributes');
  }
  if (/(?:javascript|vbscript)\s*:|url\s*\(|data:text\/html/i.test(sanitized)) {
    throw new Error('SVG contains an unsafe URL');
  }

  return sanitized;
}
