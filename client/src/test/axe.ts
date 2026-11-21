import axe from 'axe-core';

/**
 * Runs axe-core on a rendered container. Colour contrast needs real layout (not
 * jsdom): it is covered by contrast.test.ts instead. "region" is page-level only.
 */
export async function axeViolations(container: Element, { page = false } = {}): Promise<string[]> {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: page } },
  });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
}
