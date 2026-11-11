// Deep links are untrusted input: stage an ID for explicit inspector registration.
let pendingId:string|undefined;
export function receiveChromeDeepLink(url:{href:string;path:string;fragment:string;queryParameters:URLSearchParams}):boolean {
  if(url.href.length>=2000||url.path!=="/chrome/setup"||url.fragment) return false;
  const params=url.queryParameters;
  if([...params.keys()].some(key=>key!=="extensionId")||params.getAll("extensionId").length!==1) return false;
  const id=params.get("extensionId");
  if(!id||!/^[a-p]{32}$/.test(id)) return false;
  pendingId=id;return true;
}
export function takeChromeDeepLink():string|undefined {
  const id=pendingId;pendingId=undefined;return id;
}
