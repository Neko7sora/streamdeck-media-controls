import {existsSync} from "node:fs";
import {join} from "node:path";

type DisplayFont = {family:string; fontfile?:string};
const directory=join(process.env.WINDIR??process.env.SystemRoot??"C:\\Windows","Fonts");
const candidates=[
  {family:"Meiryo UI",regular:"meiryo.ttc",bold:"meiryob.ttc"},
  {family:"Yu Gothic UI",regular:"YuGothR.ttc",bold:"YuGothB.ttc"},
  {family:"Segoe UI",regular:"segoeui.ttf",bold:"segoeuib.ttf"}
];
const selected=process.platform==="win32"?candidates.find(font=>existsSync(join(directory,font.regular))):undefined;

/** Load the Japanese UI face explicitly instead of relying on Latin-font substitution. */
export function displayFont(bold=false):DisplayFont {
  if(!selected) return {family:"sans-serif"};
  const fontfile=join(directory,bold&&existsSync(join(directory,selected.bold))?selected.bold:selected.regular);
  return {family:selected.family,fontfile};
}
