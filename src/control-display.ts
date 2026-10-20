import type {AudioTarget,MediaItem} from "./media-model.js";

export function mediaTargetName(media:MediaItem|null):string {
  if(!media) return "対象なし";
  let site="";
  try {site=new URL(media.page_url??"").hostname.replace(/^www\./,"");} catch {}
  if(media.source==="chrome") return site?`${site} · Chrome`:"Chrome";
  const id=media.app_id?.trim();
  const app=id?.includes("\\")||id?.includes("/")?id.split(/[\\/]/).pop()!:id;
  const name=app?.replace(/\.exe$/i,"").split("_")[0]?.split("!")[0]||"Windows メディア";
  return site&&/chrome/i.test(name)?`${site} · ${name}`:name;
}

export function audioTargetName(target:AudioTarget|null,selected="master"):string {
  return selected==="master"?"PC全体":target?.name?.trim()||"対象なし";
}
