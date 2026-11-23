import streamDeck from "@elgato/streamdeck";

let writes: Promise<unknown> = Promise.resolve();
export async function readPluginSettings() {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([streamDeck.settings.getGlobalSettings(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Global settings timed out")), 5000);
    })]);
  } finally {clearTimeout(timer);}
}
// Chrome and iCUE share one settings object. Serialize read/merge/write so
// concurrent integration changes cannot overwrite each other's preferences.
export function updatePluginSettings(changes: Record<string, string | boolean>, isActive = () => true): Promise<void> {
  const result = writes.then(async () => {
    const saved = await readPluginSettings();
    if (!isActive()) throw new Error("Plugin stopped");
    await streamDeck.settings.setGlobalSettings({...saved, ...changes});
  });
  writes = result.catch(() => {});
  return result;
}
