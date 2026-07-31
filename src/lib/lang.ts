export const LANGUAGES = ['en', 'zh', 'ja', 'ko', 'fr', 'es', 'pt'] as const
export type Lang = (typeof LANGUAGES)[number]

// Short glyph shown on the language toggle's cube faces.
export const LANG_GLYPH: Record<Lang, string> = {
  en: 'EN',
  zh: '中',
  ja: '日',
  ko: '한',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
}

export function nextLang(lang: Lang): Lang {
  const i = LANGUAGES.indexOf(lang)
  return LANGUAGES[(i + 1) % LANGUAGES.length]
}
