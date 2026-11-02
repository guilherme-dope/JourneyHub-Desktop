import i18next from 'i18next';
import pt from '../locales/pt-BR.json';
import en from '../locales/en-US.json';
import type { Presentation } from './presentation';

export const resources = { 'pt-BR': { translation: pt }, 'en-US': { translation: en } };
export function createTranslations(language: Presentation['language']) {
  const instance = i18next.createInstance();
  void instance.init({ resources: structuredClone(resources), lng: language, fallbackLng: 'en-US', supportedLngs: ['pt-BR', 'en-US'], keySeparator: false, initAsync: false, interpolation: { escapeValue: false } });
  return instance;
}

const messageKeys = new Map<string, string>();
for (const dictionary of [pt, en]) for (const [key, value] of Object.entries(dictionary)) messageKeys.set(value, key);
const patterns = [pt, en].flatMap(dictionary => Object.entries(dictionary).filter(([, value]) => value.includes('{{')).map(([key, value]) => {
  const names: string[] = [];
  let start = 0;
  let pattern = '^';
  for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
    pattern += value.slice(start, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s\\S]*?)';
    names.push(match[1]); start = match.index! + match[0].length;
  }
  pattern += value.slice(start).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  return { key, names, pattern: new RegExp(pattern) };
}));
/** Only application messages enter this function. Never pass user notes or audit values. */
export function translateMessage(message: string, instance: ReturnType<typeof createTranslations>): string {
  const key = messageKeys.get(message);
  if (key) return instance.t(key);
  for (const item of patterns) {
    const match = item.pattern.exec(message);
    if (!match) continue;
    const values = Object.fromEntries(item.names.map((name, index) => [name, name === 'count' ? Number(match[index + 1]) : match[index + 1]]));
    if (item.key === 'notice.saved') values.action = translateMessage(String(values.action), instance);
    return instance.t(item.key, values);
  }
  const missing = /^Configure (MSSQL_\w+) no arquivo \.env local\.$/.exec(message);
  if (missing) return instance.t('error.configureField', { field: missing[1] });
  const flag = /^(MSSQL_\w+) deve ser true ou false\.$/.exec(message);
  if (flag) return instance.t('error.booleanField', { field: flag[1] });
  return message;
}

export function formatDate(date: string, locale: Presentation['formatLocale']): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(`${date}T12:00:00Z`));
}
export function formatInstant(value: string, locale: Presentation['formatLocale'], timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
