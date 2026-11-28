import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { detectLocale, LOCALE_KEY, LOCALES, type LocaleId } from './locales';
import { ru } from './ru';

export type Messages = typeof ru;

const PACKS: Record<LocaleId, Messages> = { ru };

interface LocaleValue {
  id: LocaleId;
  tag: string;
  set(id: LocaleId): void;
}

const DEFAULT_ENTRY = LOCALES[0]!;
let active: { id: LocaleId; tag: string } = { id: DEFAULT_ENTRY.id, tag: DEFAULT_ENTRY.tag };

const LocaleContext = createContext<LocaleValue>({ ...active, set: () => {} });

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(LOCALE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStored(id: LocaleId): void {
  try {
    globalThis.localStorage?.setItem(LOCALE_KEY, id);
  } catch {
    // Хранилище может быть закрыто политикой браузера; выбор живёт до перезагрузки.
  }
}

function initialLocale(): LocaleId {
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages ?? [];
  const id = detectLocale(languages, readStored(), LOCALES.map((l) => l.id));
  return LOCALES.find((l) => l.id === id)?.id ?? DEFAULT_ENTRY.id;
}

export function activeLocale(): { id: LocaleId; tag: string } {
  return active;
}

export function messages(): Messages {
  return PACKS[active.id];
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<LocaleId>(initialLocale);
  const value = useMemo<LocaleValue>(() => {
    const entry = LOCALES.find((l) => l.id === id) ?? DEFAULT_ENTRY;
    active = { id: entry.id, tag: entry.tag };
    return {
      id: entry.id,
      tag: entry.tag,
      set(next) {
        writeStored(next);
        setId(next);
      },
    };
  }, [id]);
  useEffect(() => {
    document.documentElement.lang = value.id;
  }, [value.id]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}

export function useT(): Messages {
  return PACKS[useContext(LocaleContext).id];
}
