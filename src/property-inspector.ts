import streamDeck from "@elgato/streamdeck";
import {t} from "./localization.js";
import type {Instance,Settings} from "./action-settings.js";
import {chromeConnectionStatus} from "./chrome-server.js";
import {chromeIntegrationStatus,configureChromeIntegration,setChromeIntegrationEnabled,subscribeChromeIntegration} from "./chrome-integration.js";
import {subscribeChanges,availableSessions,audioTargets} from "./media-state.js";
import {displayTitle} from "./media-model.js";
import {InspectorUpdates} from "./inspector-updates.js";
import {icueIntegrationStatus,setIcueIntegrationEnabled,subscribeIcueIntegration} from "./icue-integration.js";

import {receiveChromeDeepLink,takeChromeDeepLink} from "./chrome-deep-link.js";

const inspectorUpdates=new InspectorUpdates();
let inspectorId:string|undefined,inspectorRevision=0,inspectorSending=false,inspectorDirty=false;
function inspectorPayload() {
  return {
    chromeConnection:chromeConnectionStatus(),
    chromeIntegration:chromeIntegrationStatus(),
    icueIntegration:icueIntegrationStatus(),
    sessions:availableSessions().map(s=>({id:s.session_id??"",label:`${s.source}: ${displayTitle(s)} (${s.app_id||s.tab_id||""})`,details:JSON.stringify({...s,artwork_data_url:s.artwork_data_url?"[image available]":null,fallback_artwork_data_url:s.fallback_artwork_data_url?"[Windows fallback available]":null,app_icon_data_url:s.app_icon_data_url?"[app icon available]":null,favicon_data_url:s.favicon_data_url?"[favicon available]":null},null,2)})),
    audio:audioTargets().map(v=>({id:v.id,label:`${v.name||t("metadata.unknownApp")}${v.pid!==undefined?` (PID ${v.pid})`:""}`,volume:v.volume,muted:v.muted}))
  };
}
function notifyInspector():void {
  if(!inspectorId||streamDeck.ui.action?.id!==inspectorId) {inspectorId=undefined;inspectorUpdates.reset();return;}
  inspectorDirty=true;if(inspectorSending) return;inspectorSending=true;
  void (async()=>{try {while(inspectorDirty) {
    inspectorDirty=false;const id=inspectorId;
    if(!id||streamDeck.ui.action?.id!==id) break;
    const changes=inspectorUpdates.changes(inspectorPayload());
    if(Object.keys(changes).length) await streamDeck.ui.sendToPropertyInspector({response:"optionsChanged",protocol:2,...changes});
  }} catch(e){inspectorUpdates.reset();streamDeck.logger.warn(String(e));} finally{inspectorSending=false;}})();
}
let inspectorConnection="";
export function refreshInspectorConnection():void {
  if(!inspectorId) return;
  const connection=chromeConnectionStatus(),key=JSON.stringify([connection.state,connection.sessions]);
  if(key!==inspectorConnection) {inspectorConnection=key;notifyInspector();}
}
export async function notifySettingsChanged(instance:Instance,settings:Settings):Promise<void> {
  if(inspectorId===instance.id&&streamDeck.ui.action?.id===instance.id) {
    await streamDeck.ui.sendToPropertyInspector({response:"settingsChanged",settings,settingsRevision:inspectorRevision});
  }
}
export function startPropertyInspector():void {
  streamDeck.system.onDidReceiveDeepLink(ev=>{
    if(!receiveChromeDeepLink(ev.url)||!streamDeck.ui.action) return;
    const extensionId=takeChromeDeepLink();
    void streamDeck.ui.sendToPropertyInspector({response:"chromeSetup",extensionId}).catch(e=>streamDeck.logger.warn(String(e)));
  });
  subscribeChanges(notifyInspector);
  subscribeChromeIntegration(notifyInspector);
  subscribeIcueIntegration(notifyInspector);
  streamDeck.ui.onSendToPlugin(ev=>{
    const request=ev.payload;
    if(!request||typeof request!=="object"||Array.isArray(request)) return;
    if(request.request==="setChromeIntegration") {
      const requestId=request.requestId;
      if(streamDeck.ui.action?.id!==ev.action.id||typeof request.enabled!=="boolean"||typeof requestId!=="string"||!/^[a-f0-9-]{36}$/i.test(requestId)) return;
      void (async()=>{
        let failed=false;
        try {await setChromeIntegrationEnabled(request.enabled as boolean);}
        catch(error) {failed=true;streamDeck.logger.warn(String(error));}
        if(streamDeck.ui.action?.id!==ev.action.id) return;
        await streamDeck.ui.sendToPropertyInspector({response:"chromeIntegration",requestId,failed,chromeIntegration:chromeIntegrationStatus(),chromeConnection:chromeConnectionStatus()});
      })().catch(error=>streamDeck.logger.warn(String(error)));
      return;
    }
    if(request.request==="setIcueIntegration") {
      const requestId=request.requestId;
      if(streamDeck.ui.action?.id!==ev.action.id||typeof request.enabled!=="boolean"||typeof requestId!=="string"||!/^[a-f0-9-]{36}$/i.test(requestId)) return;
      void (async()=>{
        let failed=false;
        try {await setIcueIntegrationEnabled(request.enabled as boolean);}
        catch(error) {failed=true;streamDeck.logger.warn(String(error));}
        if(streamDeck.ui.action?.id!==ev.action.id) return;
        await streamDeck.ui.sendToPropertyInspector({response:"icueIntegration",requestId,failed,icueIntegration:icueIntegrationStatus()});
      })().catch(error=>streamDeck.logger.warn(String(error)));
      return;
    }
    if(request.request==="alive"||request.request==="watch") {
      if(streamDeck.ui.action?.id!==ev.action.id) return;
      if(request.request==="watch"&&Number.isSafeInteger(request.settingsRevision)&&Number(request.settingsRevision)>=0) inspectorRevision=Number(request.settingsRevision);
      // An open inspector can outlive this plugin process and retain push mode.
      // Restore its full handshake before relying on collection change notices.
      void streamDeck.ui.sendToPropertyInspector({response:"alive",protocol:2,chromeConnection:chromeConnectionStatus(),chromeIntegration:chromeIntegrationStatus(),
        ...(inspectorId!==ev.action.id?{optionsRequired:true}:{})}).catch(e=>streamDeck.logger.warn(String(e)));return;
    }
    if(request.request==="registerChromeHost") {
      const requestId=request.requestId;
      if(streamDeck.ui.action?.id!==ev.action.id||typeof requestId!=="string"||!/^[a-f0-9-]{36}$/i.test(requestId)) return;
      void configureChromeIntegration(request.extensionId).catch(error=>{
        streamDeck.logger.warn(String(error));
        return {status:"failed",message:t("chrome.registration.failed")};
      }).then(async result=>{
        if(streamDeck.ui.action?.id!==ev.action.id) return;
        await streamDeck.ui.sendToPropertyInspector({response:"chromeHostRegistration",requestId,...result,chromeIntegration:chromeIntegrationStatus(),chromeConnection:chromeConnectionStatus()});
      }).catch(e=>streamDeck.logger.warn(String(e)));
      return;
    }
    if(request.request!=="options") return;
    const settingsRevision=request.settingsRevision;
    if(typeof settingsRevision!=="number"||!Number.isSafeInteger(settingsRevision)||settingsRevision<0) return;
    void (async()=>{const settings=await ev.action.getSettings();
      if(streamDeck.ui.action?.id!==ev.action.id) return;
      const payload=inspectorPayload();inspectorId=ev.action.id;inspectorRevision=settingsRevision;inspectorUpdates.reset();inspectorUpdates.changes(payload);
      await streamDeck.ui.sendToPropertyInspector({protocol:2,settings,settingsRevision,...payload,chromeSetupExtensionId:takeChromeDeepLink()});
    })().catch(e=>streamDeck.logger.warn(String(e)));
  });
}
