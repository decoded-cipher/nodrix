// Rebuilds a deployment's wrangler.toml: bindings, flags and build config from
// upstream's carrier template, identity from the deployment's own file.
//
// Keeping the deployment's file verbatim froze its topology at whatever the
// Deploy button wrote on day one; taking upstream's verbatim would rename the
// Worker, creating a second one and orphaning the live one.

import { readFileSync } from 'node:fs';

const PRESERVED_TOP_KEYS = ['name', 'account_id', 'workers_dev', 'preview_urls', 'route', 'routes'];

const PRESERVED_RESOURCE_KEYS: Record<string, string[]> = {
  d1_databases: ['database_id', 'database_name'],
  kv_namespaces: ['id'],
  r2_buckets: ['bucket_name'],
};

type Section = { header: string; lines: string[] };

function keyOf(line: string): string | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(line);
  return m ? m[1]! : null;
}

// TOML arrays and inline tables can span lines; those join into one entry.
function unclosed(text: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#') break;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth > 0;
}

function parse(text: string): Section[] {
  const sections: Section[] = [{ header: '', lines: [] }];
  const raw = text.split('\n');
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]!;
    if (line.trim().startsWith('[')) {
      sections.push({ header: line.trim(), lines: [] });
      continue;
    }
    if (keyOf(line)) {
      while (unclosed(line) && i + 1 < raw.length) line += '\n' + raw[++i]!;
    }
    sections[sections.length - 1]!.lines.push(line);
  }
  return sections;
}

function valueOf(line: string): string {
  const eq = line.indexOf('=');
  return line.slice(eq + 1).trim().replace(/\s*#.*$/, '').replace(/^["']|["']$/g, '');
}

function lookup(section: Section, key: string): string | undefined {
  for (const l of section.lines) if (keyOf(l) === key) return l;
  return undefined;
}

function arrayName(header: string): string | null {
  const m = /^\[\[([A-Za-z0-9_.-]+)\]\]$/.exec(header);
  return m ? m[1]! : null;
}

export function mergeWrangler(sourceText: string, templateText: string): string {
  const source = parse(sourceText);
  const template = parse(templateText);

  const sourceTop = source[0]!;
  const sourceResources = new Map<string, Section>();
  let sourceVars: Section | undefined;
  for (const s of source) {
    const name = arrayName(s.header);
    if (name && name in PRESERVED_RESOURCE_KEYS) {
      const binding = lookup(s, 'binding');
      if (binding) sourceResources.set(`${name}:${valueOf(binding)}`, s);
    } else if (s.header === '[vars]') {
      sourceVars = s;
    }
  }

  const out: string[] = [];
  const usedTopKeys = new Set<string>();

  for (const s of template) {
    if (s.header) out.push(s.header);

    const name = arrayName(s.header);
    const resourceKeys = name ? PRESERVED_RESOURCE_KEYS[name] : undefined;
    let resource: Section | undefined;
    if (resourceKeys) {
      const binding = lookup(s, 'binding');
      if (binding) {
        resource = sourceResources.get(`${name}:${valueOf(binding)}`);
        if (!resource) {
          console.error(
            `[merge-wrangler] ${name} binding ${valueOf(binding)} is new upstream — this deployment has no id for it`
          );
        }
      }
    }

    for (const line of s.lines) {
      const key = keyOf(line);
      if (!key) {
        out.push(line);
        continue;
      }
      if (!s.header && PRESERVED_TOP_KEYS.includes(key)) {
        const own = lookup(sourceTop, key);
        usedTopKeys.add(key);
        out.push(own ?? line);
        continue;
      }
      if (resource && resourceKeys!.includes(key)) {
        out.push(lookup(resource, key) ?? line);
        continue;
      }
      if (s.header === '[vars]' && sourceVars) {
        out.push(lookup(sourceVars, key) ?? line);
        continue;
      }
      out.push(line);
    }

    // Custom domains and account ids the template never declares.
    if (!s.header) {
      const extra = PRESERVED_TOP_KEYS.filter((k) => !usedTopKeys.has(k) && lookup(sourceTop, k));
      if (extra.length) {
        let at = out.length;
        while (at > 0 && !keyOf(out[at - 1]!)) at--;
        out.splice(at, 0, ...extra.map((k) => lookup(sourceTop, k)!));
      }
    }
    if (s.header === '[vars]' && sourceVars) {
      const declared = new Set(s.lines.map(keyOf).filter(Boolean));
      for (const line of sourceVars.lines) {
        const k = keyOf(line);
        if (k && !declared.has(k)) out.push(line);
      }
    }
  }

  if (sourceVars && !template.some((s) => s.header === '[vars]')) {
    out.push('', '[vars]', ...sourceVars.lines.filter((l) => keyOf(l)));
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
}

if (import.meta.main) {
  const [, , sourcePath, templatePath] = process.argv;
  if (!sourcePath || !templatePath) {
    console.error('usage: merge-wrangler.ts <deployment.toml> <upstream-template.toml>');
    process.exit(1);
  }
  process.stdout.write(
    mergeWrangler(readFileSync(sourcePath, 'utf8'), readFileSync(templatePath, 'utf8'))
  );
}
