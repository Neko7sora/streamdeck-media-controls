import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL("../chrome-extension/background.js",import.meta.url),"utf8");
const localization=readFileSync(new URL("../chrome-extension/localization.js",import.meta.url),"utf8");
export function worker(enabled=true,imageResponse,hooks={}){
  let listener,access,removed,settingsChanged,disconnect,pulse;
  let connections=0,receiveEvent,readState,connectListener;
  const settings=hooks.settings??{enabled,token:"a".repeat(64)};
  const requests=[],commands=[],images=[],probes=[],badges=[],nativeMessages=[],storageWrites=[];
  const chrome={i18n:{getUILanguage:()=>hooks.language??"ja"},storage:{local:{async setAccessLevel(v){access=v.accessLevel;},async get(){return {...settings};},async set(values){storageWrites.push({...values});await hooks.saveSettings?.(values);Object.assign(settings,values);}},onChanged:{addListener(fn){settingsChanged=fn;}}},runtime:{onConnect:{addListener(fn){connectListener=fn;}},onMessage:{addListener(fn){listener=fn;}}},tabs:{onRemoved:{addListener(fn){removed=fn;}},async sendMessage(tab,message,options){commands.push({tab,message,options});if(hooks.sendMessage) return hooks.sendMessage(tab,message,options);return {ok:true};}}};
  const fetch=async(url,options)=>{
    if(!String(url).startsWith("http://127.0.0.1:39761/chrome")) {
      images.push({url,options});
      if(imageResponse) return imageResponse(url,options);
      return {ok:false,headers:new Headers()};
    }
    if(String(url).endsWith('/status')) {
      probes.push({url,options});
      return hooks.statusResponse?hooks.statusResponse():{ok:true,json:async()=>({ok:true,...(hooks.protocol2?{protocol:2,epoch:'epoch-1'}:{})})};
    }
    requests.push({url,options});
    assert.ok(String(url).startsWith("http://127.0.0.1:39761/chrome"));
    const body=JSON.parse(options.body);
    if(hooks.bridgeResponse) return hooks.bridgeResponse(url,body);
    return {ok:true,json:async()=>({ok:true,commands:hooks.protocol2||String(url).endsWith("/result")?[]:[{id:"cmd",tab_id:body.tab_id,frame_id:body.frame_id,document_id:body.document_id,title:"Track",command:"play-pause"}]})};
  };
  chrome.runtime.connectNative=name=>{
    assert.equal(name,'dev.local.media_controls');connections++;
    let receive;
    return {onMessage:{addListener(fn){receive=fn;receiveEvent=fn;}},onDisconnect:{addListener(fn){disconnect=fn;}},postMessage(message){nativeMessages.push(message);
      if(hooks.failStream&&message.path==='/events') {receive({id:message.id,error:'unsupported'});return;}
      if(hooks.protocol2&&['/events','/unsubscribe'].includes(message.path)) {receive({id:message.id,body:{ok:true}});if(message.path==='/events') receive({event:'ready',epoch:'epoch-1'});return;}
      const url='http://127.0.0.1:39761/chrome'+message.path;
      void fetch(url,{body:JSON.stringify(message.body)}).then(r=>r.json()).then(body=>receive({id:message.id,body}),()=>receive({id:message.id,error:'unavailable'}));
    }};
  };
  class OffscreenCanvas {getContext(){return {drawImage(){}};}async convertToBlob(){return new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'});}}
  chrome.runtime.id='extension-id';
  chrome.runtime.getURL=path=>`chrome-extension://extension-id/${path}`;
  chrome.action={async setBadgeText(value){badges.push(value.text);},async setBadgeBackgroundColor(){},async setTitle(){}};
  vm.runInNewContext((hooks.source??source).replace('importScripts("localization.js");',()=>localization)+"\n;__captureState(()=>activeJobs+activeArtworkJobs+queuedFrames.length+queuedArtwork.length+nativeRequests.size);",{__captureState(fn){readState=fn;},chrome,fetch,setTimeout,clearTimeout,setInterval(fn){pulse=fn;},URL,AbortSignal,AbortController,Map,Date:hooks.now?{now:hooks.now}:Date,Number,JSON,Uint8Array,btoa,console,Headers,Blob,TextEncoder,crypto:webcrypto,OffscreenCanvas,async createImageBitmap(){return {width:32,height:32,close(){}};}});
  const status=()=>new Promise(resolve=>listener({type:'BRIDGE_STATUS'},{id:chrome.runtime.id,url:chrome.runtime.getURL('options.html')},resolve));
  hooks.inspect?.({probes,badges,status,pulse:()=>pulse(),event:value=>receiveEvent(value),connect:port=>connectListener?.(port),message:(message,sender,reply)=>listener(message,sender,reply)});
  return {busy:()=>readState(),disconnect:()=>disconnect(),connections:()=>connections,send:(media,frame=0,tab=4,documentId=`doc-${frame}`)=>listener({type:"MEDIA_UPDATE",media},{tab:{id:tab,title:"Tab"},frameId:frame,documentId,url:`https://user:password@site.test/frame-${frame}?access_token=private#secret`}),remove:id=>removed(id),changeSettings(values){const changes={};for(const [key,value] of Object.entries(values)) {changes[key]={oldValue:settings[key],newValue:value};settings[key]=value;}settingsChanged(changes,"local");},requests,commands,images,nativeMessages,settings,storageWrites,access:()=>access};
}
