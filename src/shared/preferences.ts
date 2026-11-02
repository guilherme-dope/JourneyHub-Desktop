import { z } from 'zod';
export const preferencesSchema = z.object({
  startWithWindows: z.boolean(),
  reminders: z.boolean(),
  week: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable()).length(7),
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
// Monday through Sunday; disabled until explicitly configured.
export const defaultPreferences: Preferences = { startWithWindows: false, reminders: false, week: ['08:00', '08:00', '08:00', '08:00', '08:00', null, null] };
