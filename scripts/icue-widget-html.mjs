import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// iCUE evaluates body script blocks in its property scope. A normal external
// script executes outside that scope and cannot read the configured token.
export async function buildIcueHtml(source) {
  let html = (await readFile(join(source, 'index.html'), 'utf8'))
    .replace(/  <script src="scripts\/demo-provider\.js"><\/script>\r?\n/, '');
  if (html.includes('demo-provider.js')) throw new Error('Demo script still referenced in package');
  for (const file of ['bridge.js', 'widget.js']) {
    const marker = `<script src="scripts/${file}"></script>`;
    if (!html.includes(marker)) throw new Error(`Missing iCUE script: ${file}`);
    const code = await readFile(join(source, 'scripts', file), 'utf8');
    if (/<\/script/i.test(code)) throw new Error(`Unsafe inline script terminator: ${file}`);
    html = html.replace(marker, () => `<script>\n${code}\n  </script>`);
  }
  return html;
}
