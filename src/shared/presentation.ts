import { z } from 'zod';
export const presentationSchema = z.object({
  version: z.literal(1),
  language: z.enum(['pt-BR', 'en-US']),
  formatLocale: z.enum(['pt-BR', 'en-US']),
}).strict();
export type Presentation = z.infer<typeof presentationSchema>;
export function detectPresentation(languages: string[]): Presentation {
  const language = languages.map(value => value.toLowerCase()).find(value => value.startsWith('pt') || value.startsWith('en'))?.startsWith('pt') ? 'pt-BR' : 'en-US';
  const formatLocale = languages[0]?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  return { version: 1, language, formatLocale };
}
