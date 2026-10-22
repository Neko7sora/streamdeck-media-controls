import catalogs from "./locale-data.generated.js";

export type Catalogs=Record<string,Record<string,string>>;
export type Parameters=Record<string,string|number>;
type LocalizedDocument={documentElement:{lang:string};querySelectorAll(selector:string):Iterable<{dataset:{i18n?:string};textContent:string|null}>};

/** Regional locales fall back through their parents, then to English. */
export function createTranslator(messages:Catalogs,initialLanguage="en") {
  let language="",active:Record<string,string>=Object.create(null);
  // Alternating literal text and parameter names, parsed once per language change.
  let templates:Record<string,string[]>=Object.create(null);
  const supported=new Map(Object.keys(messages).map(name=>[name.toLowerCase(),name]));
  function setLanguage(value:string):void {
    let tag=value.trim().replaceAll("_","-").toLowerCase();
    const fallbacks:string[]=[];
    while(tag){
      const match=supported.get(tag);
      if(match) fallbacks.push(match);
      const end=tag.lastIndexOf("-");tag=end<0?"":tag.slice(0,end);
    }
    if(!fallbacks.includes("en")) fallbacks.push("en");
    const selected=fallbacks[0]!;
    if(language===selected) return;
    language=selected;
    active=Object.create(null);
    templates=Object.create(null);
    // Resolve all missing translations once, outside the display update loop.
    for(let index=fallbacks.length-1;index>=0;index--) Object.assign(active,messages[fallbacks[index]!]);
    for(const [key,text] of Object.entries(active)) {
      const parts=text.split(/\{(\w+)\}/g);
      if(parts.length>1) templates[key]=parts;
    }
  }
  function t(key:string,parameters?:Parameters):string {
    const text=active[key]??key;
    if(!parameters) return text;
    const parts=templates[key];
    if(!parts) return text;
    let result=parts[0]!;
    for(let index=1;index<parts.length;index+=2) {
      const name=parts[index]!;
      result+=(Object.hasOwn(parameters,name)?String(parameters[name]):`{${name}}`)+parts[index+1]!;
    }
    return result;
  }
  function localizePage(document:LocalizedDocument):void {
    document.documentElement.lang=language;
    for(const element of document.querySelectorAll("[data-i18n]")) element.textContent=t(element.dataset.i18n!);
  }
  setLanguage(initialLanguage);
  return {setLanguage,t,localizePage};
}

// The plugin, inspector and extension each have an independent runtime instance.
export const {setLanguage,t,localizePage}=createTranslator(catalogs);
