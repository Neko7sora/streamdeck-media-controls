import {readFile} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import sharp from 'sharp';

// Supplement CLI 0.5.1: it does not check preview dimensions, translation
// coverage, duplicate property IDs or references to undeclared properties.
// https://docs.elgato.com/icue/widgets/specification/
// https://docs.elgato.com/icue/widgets/references/translations/
export async function checkIcuePresentation(source) {
  const html = await readFile(join(source, 'index.html'), 'utf8');
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const tags = [...head.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*("[^"]*"|'[^']*')/g)]
      .map(([, name, value]) => [name, value.slice(1, -1)])));
  const require = (condition, message) => {if (!condition) throw new Error(message);};
  const preview = tags.find(tag => tag.name === 'x-icue-widget-preview');
  if (preview) {
    require(preview.content?.trim(), 'iCUE widget preview must specify an image path');
    const file = resolve(source, preview.content);
    const inside = relative(resolve(source), file);
    require(inside && !inside.startsWith('..') && !isAbsolute(inside), 'iCUE widget preview must stay inside the widget directory');
    const image = await sharp(file).metadata();
    require(image.width === 128 && image.height === 56,
      `iCUE widget preview must be 128 × 56 pixels (got ${image.width} × ${image.height})`);
  }

  const properties = new Set();
  for (const tag of tags.filter(tag => tag.name === 'x-icue-property')) {
    require(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tag.content ?? ''), `Invalid iCUE property ID: ${tag.content}`);
    require(!properties.has(tag.content), `Duplicate iCUE property ID: ${tag.content}`);
    require(tag['data-label']?.trim(), `Missing iCUE property label: ${tag.content}`);
    properties.add(tag.content);
  }
  const groups = /<script\b[^>]*\bid=["']x-icue-groups["'][^>]*>([\s\S]*?)<\/script>/i.exec(head);
  const grouped = new Set();
  if (groups) for (const group of JSON.parse(groups[1])) {
    require(typeof group.title === 'string' && group.title.trim(), 'Missing iCUE property group title');
    for (const property of group.properties) {
      require(properties.has(property), `Undeclared iCUE property in group: ${property}`);
      require(!grouped.has(property), `Repeated iCUE property in groups: ${property}`);
      grouped.add(property);
    }
  }

  // Settings currently use literal tr('key') calls. Dynamic runtime translations
  // need their own coverage checks if introduced later.
  const keys = new Set([...head.matchAll(/\btr\(\s*(['"])(.*?)\1\s*\)/g)].map(match => match[2]));
  if (keys.size) {
    const translations = JSON.parse(await readFile(join(source, 'translation.json'), 'utf8'));
    const english = translations?.en?.translation;
    require(english && typeof english === 'object' && !Array.isArray(english), 'iCUE translations require an English fallback');
    for (const key of keys) require(Object.hasOwn(english, key) && typeof english[key] === 'string' && english[key].trim(),
      `Missing iCUE English translation: ${key}`);
  }
  console.log(`iCUE presentation: OK (${properties.size} property IDs, ${keys.size} translated settings; preview 128 × 56 when declared).`);
}
