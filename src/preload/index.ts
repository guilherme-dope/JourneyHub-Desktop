import { contextBridge, ipcRenderer } from 'electron';
import type { JourneyApi } from '../shared/contracts';
const api: JourneyApi = {
  openExistingSql: () => ipcRenderer.invoke('storage:open-existing-sql'),
  useLocalStorage: () => ipcRenderer.invoke('storage:use-local'),
  presentation: () => ipcRenderer.invoke('presentation:get'),
  savePresentation: value => ipcRenderer.invoke('presentation:save', value),
  onPresentationChange: callback => {
    const listener = (_event: unknown, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on('presentation:changed', listener);
    return () => { ipcRenderer.removeListener('presentation:changed', listener); };
  },
  backup: () => ipcRenderer.invoke('storage:backup'),
  restoreBackup: () => ipcRenderer.invoke('storage:restore'),
  rules: () => ipcRenderer.invoke('reference:get'),
  saveReference: minutes => ipcRenderer.invoke('reference:save', minutes),
  preferences: () => ipcRenderer.invoke('desktop:get'),
  saveReminders: value => ipcRenderer.invoke('desktop:reminders', value),
  savePreferences: value => ipcRenderer.invoke('desktop:save', value),
  onDesktopEvent: callback => {
    const settings = () => callback('settings'), refresh = () => callback('refresh');
    ipcRenderer.on('desktop:settings', settings); ipcRenderer.on('desktop:refresh', refresh);
    return () => { ipcRenderer.removeListener('desktop:settings', settings); ipcRenderer.removeListener('desktop:refresh', refresh); };
  },
  health: () => ipcRenderer.invoke('journey:health'),
  list: period => ipcRenderer.invoke('journey:list', period),
  current: () => ipcRenderer.invoke('journey:current'),
  trash: () => ipcRenderer.invoke('journey:trash'),
  mutate: command => ipcRenderer.invoke('journey:mutate', command),
  audit: id => ipcRenderer.invoke('journey:audit', { id }),
  export: (period, mode = 'summary') => ipcRenderer.invoke('journey:export', { ...period, mode }),
};
contextBridge.exposeInMainWorld('journey', api);
