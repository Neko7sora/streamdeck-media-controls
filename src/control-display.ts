import {t} from "./localization.js";
import type {AudioTarget,MediaItem} from "./media-model.js";

export function mediaTargetName(media:MediaItem|null):string {
  if(!media) return t("no.target");
  let site="";
  try {site=new URL(media.page_url??"").hostname.replace(/^www\./,"");} catch {}
  if(media.source==="chrome") return site?`${site} · Chrome`:"Chrome";
  const id=media.app_id?.trim();
  const app=id?.includes("\\")||id?.includes("/")?id.split(/[\\/]/).pop()!:id;
  const name=app?.replace(/\.exe$/i,"").split("_")[0]?.split("!")[0]||t("windows.media");
  return site&&/chrome/i.test(name)?`${site} · ${name}`:name;
}

export function audioTargetName(target:AudioTarget|null,selected="master"):string {
  return selected==="master"?t("system"):target?.name?.trim()||t("no.target");
}
