import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createTranslations, translateMessage, formatDate, formatInstant } from '../shared/i18n';
import type { Presentation } from '../shared/presentation';
import { TIME_ZONE } from '../shared/contracts';

export const translations = createTranslations('en-US');
let current: Presentation = { version: 1, language: 'en-US', formatLocale: 'en-US' };
export const t = (key: string, values?: Record<string, unknown>): string => translations.t(key, values);
export const message = (value: string): string => translateMessage(value, translations);
export const dateLabel = (value: string): string => formatDate(value, current.formatLocale);
export const displayTime = (value: string): string => formatInstant(value, current.formatLocale, TIME_ZONE);
export const numberLabel = (value: number): string => new Intl.NumberFormat(current.formatLocale).format(value);
export const clockLabel = (value: string, seconds = true): string => new Intl.DateTimeFormat(current.formatLocale, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' as const } : {}) }).format(new Date(value));

function apply(value: Presentation) {
  current = value;
  void translations.changeLanguage(value.language);
  document.documentElement.lang = value.language;
}
const Context = createContext<{ value: Presentation; save(value: Presentation): Promise<void> } | null>(null);
export function PresentationProvider({ initial, children }: { initial: Presentation; children: ReactNode }) {
  const [value, setValue] = useState(initial);
  useEffect(() => window.journey.onPresentationChange(next => { apply(next); setValue(next); }), []);
  return <Context.Provider value={{ value, save: async next => {
    const result = await window.journey.savePresentation(next);
    if (!result.ok) throw new Error(result.message);
    apply(result.value); setValue(result.value);
  } }}><I18nextProvider i18n={translations}>{children}</I18nextProvider></Context.Provider>;
}
export function usePresentation() {
  const value = useContext(Context);
  if (!value) throw new Error('Presentation provider missing');
  return value;
}
export function initializePresentation(value: Presentation) { apply(value); }
