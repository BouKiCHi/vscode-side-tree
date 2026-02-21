import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type LocaleTable = Record<string, string>;

function loadJson(filePath: string): LocaleTable {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as LocaleTable;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Ignore and fall back to empty table.
  }
  return {};
}

const root = path.resolve(__dirname, '..');
const base = loadJson(path.join(root, 'package.nls.json'));
const lang = (vscode.env.language || 'en').split('-')[0];
const localePath = path.join(root, `package.nls.${lang}.json`);
const locale = fs.existsSync(localePath) ? loadJson(localePath) : {};

export function localize(key: string, fallback: string, ...args: unknown[]): string {
  const template = locale[key] ?? base[key] ?? fallback;
  return template.replace(/\{(\d+)\}/g, (_match, index) => {
    const value = args[Number(index)];
    return value === undefined ? '' : String(value);
  });
}
