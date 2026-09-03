import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Prompt assembly is deliberately boring: markdown templates on disk with
 * `{{variable}}` slots, rendered with a plain object. Boring means diffable,
 * reviewable, and version-controlled, which is what you want for the part of
 * an autonomous system that most determines its behavior.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");

export function loadTemplate(name: string): string {
  return readFileSync(resolve(ROOT, "prompts", `${name}.md`), "utf8");
}

export function loadBrief(pathOrName: string): string {
  const candidates = [
    resolve(process.cwd(), pathOrName),
    resolve(ROOT, "briefs", pathOrName),
    resolve(ROOT, "briefs", `${pathOrName}.md`),
  ];
  for (const c of candidates) {
    try {
      return readFileSync(c, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error(`Brief not found: ${pathOrName} (looked in cwd and ./briefs)`);
}

export function render(template: string, vars: Record<string, string>): string {
  const missing: string[] = [];
  const out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) {
      missing.push(key);
      return `{{${key}}}`;
    }
    return v;
  });
  if (missing.length) throw new Error(`Template is missing variables: ${missing.join(", ")}`);
  return out;
}

/** Convenience: render a named template with a brief plus any extra vars. */
export function buildPrompt(templateName: string, brief: string, extra: Record<string, string> = {}): string {
  return render(loadTemplate(templateName), { brief: brief.trim(), ...extra });
}
