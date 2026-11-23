import {homedir} from "node:os";
import {join} from "node:path";
export function privateDirectory():string {
  // LOCALAPPDATA also permits isolated test fixtures on non-Windows hosts.
  const base=process.env.LOCALAPPDATA ?? (process.platform==="darwin"?join(homedir(),"Library","Application Support"):undefined);
  if(!base) throw new Error("LOCALAPPDATA is required for private token storage");
  return join(base,"StreamDeckMediaControls");
}
