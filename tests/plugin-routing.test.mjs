import {test} from "node:test";
import assert from "node:assert/strict";
import {load} from "./load.mjs";
test("Now Playing operates the session last sent to the display, and never falls back after removal",async()=>{
  const a={source:"windows",session_id:"A",title:"Track",controls:{toggle:true}},b={...a,session_id:"B"};
  const driver={instances:[],commands:[],audioRequests:[],inspectorReplies:[],current:a,sessions:[a,b]};globalThis.__mediaTest=driver;
  const mocks={
    sdk:`const d=globalThis.__mediaTest;export class SingletonAction{actions=[];} export function action(){return c=>c;} export default {actions:{registerAction(a){d.instances.push(a);}},ui:{get action(){return d.inspectorAction;},onSendToPlugin(fn){d.onSendToPlugin=fn;},async sendToPropertyInspector(payload){d.inspectorReplies.push(payload);}},logger:{warn(){},error(){},info(){}},async connect(){}};`,
    state:`const d=globalThis.__mediaTest;export function currentMedia(id="auto"){return id==="auto"?d.current:d.sessions.find(x=>x.session_id===id)??null;}export function availableSessions(){return d.sessions;}export function audioTarget(id){d.audioRequests.push(id);return {name:id,volume:0.5,muted:false};}export function audioTargets(){return [];}export function subscribe(){}export function startMediaPolling(){return ()=>{};}`,
    native:`export async function nativeCommand(c){const d=globalThis.__mediaTest;d.commands.push(c);await d.command?.(c);}`,
    chrome:`export function chromeConnectionStatus(){return {state:"connected",lastSeen:123,sessions:0};}export function startChromeServer(){return {close(){},closeAllConnections(){}};}export async function chromeCommand(){throw Error("Unexpected Chrome command");}`,
    registration:`export function registerChromeHost(){const d=globalThis.__mediaTest;d.registrations=(d.registrations??0)+1;return d.registration??Promise.resolve({status:"registered",message:"Registered"});}export function stopChromeRegistration(){}`,
    art:`export async function artwork(){await globalThis.__mediaTest.artwork?.();return undefined;} export async function applicationIcon(m){return m?.favicon_data_url??m?.app_icon_data_url;}`
  };
  const plugin={name:"test-ports",setup(build){
    build.onResolve({filter:/@elgato\/streamdeck$|\.\/media-state\.js$|\.\/native-client\.js$|\.\/chrome-server\.js$|\.\/chrome-registration\.js$|\.\/artwork\.js$/},args=>({path:args.path==="@elgato/streamdeck"?"sdk":args.path.includes("media-state")?"state":args.path.includes("native-client")?"native":args.path.includes("chrome-server")?"chrome":args.path.includes("chrome-registration")?"registration":"art",namespace:"test"}));
    build.onLoad({filter:/.*/,namespace:"test"},args=>({contents:mocks[args.path],loader:"js"}));
  }};
  await load("plugin",[plugin]);
  assert.equal(driver.registrations??0,0,"startup must not register a Chrome host");
  const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
  let releaseSettings;
  const settingsRead=new Promise(resolve=>{releaseSettings=resolve;});
  const inspectorAction={id:"inspector-A",getSettings:()=>settingsRead};
  driver.inspectorAction=inspectorAction;
  driver.onSendToPlugin({action:inspectorAction,payload:{request:"options",settingsRevision:7}});
  driver.inspectorAction={id:"inspector-B"};
  releaseSettings({mediaTarget:"A"});await nextTurn();
  assert.equal(driver.inspectorReplies.length,0,"an old options request cannot be routed to another inspector");
  const currentInspector={id:"inspector-B",async getSettings(){return {mediaTarget:"B"};}};
  driver.inspectorAction=currentInspector;
  driver.onSendToPlugin({action:currentInspector,payload:{request:"options",settingsRevision:8}});await nextTurn();
  assert.equal(driver.inspectorReplies.at(-1).settingsRevision,8);
  assert.deepEqual(driver.inspectorReplies.at(-1).settings,{mediaTarget:"B"});
  assert.equal(driver.inspectorReplies.at(-1).sessions.length,2);
  assert.deepEqual(driver.inspectorReplies.at(-1).chromeConnection,{state:'connected',lastSeen:123,sessions:0});
  let closeSettings;
  const closingInspector={id:"inspector-B",getSettings:()=>new Promise(resolve=>{closeSettings=resolve;})};
  driver.onSendToPlugin({action:closingInspector,payload:{request:"options",settingsRevision:9}});
  driver.inspectorAction=undefined;
  closeSettings({mediaTarget:"B"});await nextTurn();
  assert.equal(driver.inspectorReplies.length,1,"closing the inspector drops its pending options response");
  const requestId="11111111-1111-1111-1111-111111111111";
  driver.inspectorAction=currentInspector;
  driver.onSendToPlugin({action:currentInspector,payload:{request:"registerChromeHost",requestId}});await nextTurn();
  assert.equal(driver.registrations,1);
  assert.deepEqual(driver.inspectorReplies.at(-1),{response:"chromeHostRegistration",requestId,status:"registered",message:"Registered"});
  let finishRegistration;driver.registration=new Promise(resolve=>{finishRegistration=resolve;});
  driver.onSendToPlugin({action:currentInspector,payload:{request:"registerChromeHost",requestId}});
  driver.inspectorAction={id:"different-inspector"};
  const replyCount=driver.inspectorReplies.length;finishRegistration({status:"not-found",message:"Missing"});await nextTurn();
  assert.equal(driver.inspectorReplies.length,replyCount,"registration results must not be sent to a different action");
  driver.onSendToPlugin({action:currentInspector,payload:{request:"registerChromeHost",requestId}});
  assert.equal(driver.registrations,2,"requests from an inactive inspector cannot register a host");
  driver.inspectorAction=currentInspector;
  driver.onSendToPlugin({action:currentInspector,payload:{request:"registerChromeHost",requestId:"invalid"}});
  assert.equal(driver.registrations,2);
  const action=driver.instances.find(x=>x.constructor.name==="NowPlaying");
  let alerts=0;
  const key={id:"key",isKey:()=>true,isDial:()=>false,async setImage(){},async setTitle(){},async showAlert(){alerts++;}};
  action.actions.push(key);await action.onWillAppear({action:key,payload:{settings:{}}});
  while(action.refreshing) await new Promise(resolve=>setTimeout(resolve,1));
  driver.current=b;
  await action.onKeyDown({action:key,payload:{settings:{}}});
  assert.equal(driver.commands.at(-1).session_id,"A");
  driver.sessions=[b];
  await action.onKeyDown({action:key,payload:{settings:{}}});
  assert.equal(driver.commands.length,1);assert.equal(alerts,1);
  const volume=driver.instances.find(x=>x.constructor.name==="VolumeDial");
  await volume.render({...key,id:"dial",isDial:()=>true,async setFeedback(){}},{globalKeys:true,audioTarget:"per-app"});
  assert.equal(driver.audioRequests.at(-1),"master");
  // A failed or pending display update must not redirect a press to another session.
  driver.sessions=[a,{...b,title:"New track"}];
  for(const name of ["NowPlaying","NowPlayingDial"]) {
    const visual=driver.instances.find(x=>x.constructor.name===name);
    const dial=name==="NowPlayingDial";
    let fail=false, pending=null;
    const instance={id:`retry-${name}`,isKey:()=>!dial,isDial:()=>dial,
      async setImage(){await send();},async setTitle(){await send();},async setFeedback(){await send();},async showAlert(){alerts++;}};
    async function send(){if(fail) throw Error("Display disconnected");if(pending) await pending;}
    const press=()=>visual[dial?"onDialDown":"onKeyDown"]({action:instance,payload:{settings:{}}});
    const settle=async()=>{while(visual.refreshing) await new Promise(resolve=>setTimeout(resolve,1));};
    visual.actions.push(instance);
    driver.current=a;
    await visual.onWillAppear({action:instance,payload:{settings:{}}});await settle();
    driver.current=driver.sessions[1];fail=true;
    visual.refresh();await settle();
    await press();assert.equal(driver.commands.at(-1).session_id,"A",`${name}: failed update`);
    fail=false;
    let release;pending=new Promise(resolve=>{release=resolve;});
    visual.refresh();await new Promise(resolve=>setTimeout(resolve,10));
    await press();assert.equal(driver.commands.at(-1).session_id,"A",`${name}: pending update`);
    release();await settle();
    await press();assert.equal(driver.commands.at(-1).session_id,"B",`${name}: successful retry`);
    visual.actions.splice(visual.actions.indexOf(instance),1);
  }
  const seeking=driver.instances.find(x=>x.constructor.name==="NowPlayingDial");
  const seekMedia={...a,playback_state:"paused",controls:{toggle:true,seek:true},timeline:{position_sec:50,start_sec:0,end_sec:100,min_seek_sec:0,max_seek_sec:100}};
  driver.sessions=[seekMedia,b];driver.current=seekMedia;
  const dial={id:"seek-dial",isKey:()=>false,isDial:()=>true,async setFeedback(){},async showAlert(){alerts++;}};
  await seeking.render(dial,{});
  driver.current=b; // Auto selection changed since the last display.
  const rotate=(ticks,settings={})=>seeking.onDialRotate({action:dial,payload:{ticks,settings}});
  await rotate(1);assert.deepEqual(driver.commands.at(-1),{command:"seek",session_id:"A",position:55});
  await rotate(-2);assert.equal(driver.commands.at(-1).position,45);
  await rotate(2,{seekStep:10});assert.equal(driver.commands.at(-1).position,65);
  await rotate(100);assert.equal(driver.commands.at(-1).position,100);
  await rotate(-100);assert.equal(driver.commands.at(-1).position,0);
  // Taps use the displayed timeline, even if only a narrower interval is seekable.
  const windowedMedia={...seekMedia,timeline:{position_sec:120,start_sec:60,end_sec:180,min_seek_sec:90,max_seek_sec:170}};
  driver.sessions=[windowedMedia];driver.current=windowedMedia;
  const tap=async x=>{
    seeking.seeking.clear(dial.id);
    await seeking.onTouchTap({action:dial,payload:{settings:{},tapPos:[x,90],hold:false}});
  };
  await tap(100);assert.equal(driver.commands.at(-1).position,120,'the midpoint must match the displayed timeline');
  await tap(6);assert.equal(driver.commands.at(-1).position,90,'the start clamps to the seekable window');
  await tap(194);assert.equal(driver.commands.at(-1).position,170,'the end clamps to the seekable window');
  driver.sessions=[{...windowedMedia,timeline:{...windowedMedia.timeline,end_sec:null}}];
  const unavailableTimelineCommands=driver.commands.length,unavailableTimelineAlerts=alerts;
  await tap(100);
  assert.equal(driver.commands.length,unavailableTimelineCommands,'an unavailable progress bar has no tap coordinate mapping');
  assert.equal(alerts,unavailableTimelineAlerts+1);
  driver.sessions=[seekMedia,b];driver.current=seekMedia;
  await rotate(1,{dialMode:"volume",audioTarget:"per-app"});
  assert.deepEqual(driver.commands.at(-1),{command:"volume",target:"per-app",delta:0.02});
  const before=driver.commands.length,previousAlerts=alerts;
  driver.sessions=[b];await rotate(1);
  assert.equal(driver.commands.length,before);assert.equal(alerts,previousAlerts+1);
  driver.sessions=[{...seekMedia,controls:{toggle:true}}];await rotate(1);
  assert.equal(driver.commands.length,before);assert.equal(alerts,previousAlerts+2);
  driver.sessions=[seekMedia];driver.current=seekMedia;
  seeking.seeking.clear(dial.id);
  const seekStart=driver.commands.length;
  let releaseSeek;
  driver.command=()=>new Promise(resolve=>{releaseSeek=resolve;});
  const pendingRotation=rotate(1);
  const pendingTap=seeking.onTouchTap({action:dial,payload:{settings:{},tapPos:[156.4,90],hold:false}});
  const nextRotation=rotate(-1);
  assert.equal(driver.commands.length,seekStart+1,'touch and rotation must share one in-flight command');
  driver.command=undefined;releaseSeek();
  await Promise.all([pendingRotation,pendingTap,nextRotation]);
  assert.deepEqual(driver.commands.slice(seekStart).map(c=>c.position),[55,75]);
  // The track must still match when a delayed tap finally reaches the queue head.
  seeking.seeking.clear(dial.id);
  driver.command=()=>new Promise(resolve=>{releaseSeek=resolve;});
  const oldRotation=rotate(1);
  const oldTap=seeking.onTouchTap({action:dial,payload:{settings:{},tapPos:[100,90],hold:false}});
  const changedTrackAlerts=alerts,changedTrackCommands=driver.commands.length;
  driver.sessions=[{...seekMedia,title:'Changed while waiting'}];
  driver.command=undefined;releaseSeek();await Promise.all([oldRotation,oldTap]);
  assert.equal(driver.commands.length,changedTrackCommands,'a queued tap cannot seek a different track');
  assert.equal(alerts,changedTrackAlerts+1);
  const long={...a,title:"春夏秋冬東西南北朝昼夕夜一二三四五六七八九十",artist:"あいうえおかきくけこさしすせそ",playback_state:"playing"};
  driver.current=long;driver.sessions=[long];
  let clock=0;const images=[],titles=[],feedback=[],updates=[];
  const scrollKey={...key,id:"long-key",async setImage(value){images.push(value);},async setTitle(value){titles.push(value);}};
  const scrollDial={...dial,id:"long-dial",async setFeedback(value){updates.push(value);feedback.push({...feedback.at(-1),...value});}};
  for(const visual of [action,seeking]) {
    const frame=visual.scrolling.frame.bind(visual.scrolling);
    visual.scrolling.frame=(...args)=>frame(...args,clock);
  }
  await action.render(scrollKey,{});await seeking.render(scrollDial,{});
  assert.equal(titles.at(-1),"");
  assert.match(images.at(-1),/^data:image\/png;base64,/);
  assert.match(feedback.at(-1).trackTitle,/^data:image\/png;base64,/);
  const firstKey=images.at(-1),firstTitle=feedback.at(-1).trackTitle;
  clock=1534;await action.render(scrollKey,{});await seeking.render(scrollDial,{});
  assert.notEqual(images.at(-1),firstKey);assert.notEqual(feedback.at(-1).trackTitle,firstTitle);
  assert.equal(updates.at(-1).artwork,undefined,"text animation must not resend the artwork");
  const movingTitle=feedback.at(-1).trackTitle;
  driver.current={...long,playback_state:"paused"};
  await seeking.render(scrollDial,{});assert.equal(feedback.at(-1).trackTitle,movingTitle);
  driver.current={...long,session_id:"different-session"};
  await action.render(scrollKey,{});await seeking.render(scrollDial,{});
  assert.equal(images.at(-1),firstKey);assert.equal(feedback.at(-1).trackTitle,firstTitle);
  driver.current={...long,favicon_data_url:'favicon'};
  await seeking.render(scrollDial,{});assert.equal(feedback.at(-1).appIcon,'favicon');
  driver.current={...long,app_icon_data_url:'app'};
  await seeking.render(scrollDial,{});assert.equal(feedback.at(-1).appIcon,'app');
  driver.current=long;
  await seeking.render(scrollDial,{});assert.match(feedback.at(-1).appIcon,/^data:image\/png;base64,/);
  assert.deepEqual(Object.keys(updates.at(-1)),['appIcon'],'clearing the badge must not resend unrelated fields');
  // Image work may finish after a page/profile switch removes an action.
  for(const name of ['NowPlaying','NowPlayingDial']) {
    const visual=driver.instances.find(x=>x.constructor.name===name);
    const originalActions=visual.actions;
    const isDial=name==='NowPlayingDial';
    const sent=[];
    const hidden={id:`hidden-${name}`,isKey:()=>!isDial,isDial:()=>isDial,
      async setImage(value){sent.push(value);},async setTitle(){},async setFeedback(value){sent.push(value);},async showAlert(){alerts++;}};
    visual.actions=[hidden];
    let releaseArtwork,startedArtwork;
    const artworkStarted=new Promise(resolve=>{startedArtwork=resolve;});
    driver.artwork=()=>{driver.artwork=undefined;startedArtwork();return new Promise(resolve=>{releaseArtwork=resolve;});};
    driver.current=long;driver.sessions=[long];
    await visual.onWillAppear({action:hidden,payload:{settings:{}}});
    await artworkStarted;
    visual.onWillDisappear({action:hidden});
    releaseArtwork();
    while(visual.refreshing) await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(sent.length,0,`${name}: disappearing actions must not receive late images`);
    assert.equal(visual.displayedSessions.has(hidden.id),false,`${name}: late renders must not restore a removed target`);
    assert.equal(visual.scrolling.instances.has(hidden.id),false,`${name}: late renders must not restart hidden text animations`);
    // The SDK action list can briefly still contain a disappearing action.
    visual.refresh();
    while(visual.refreshing) await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(sent.length,0,`${name}: refresh must skip a disappearing action`);
    await visual.onWillAppear({action:hidden,payload:{settings:{}}});
    while(visual.refreshing) await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(sent.length,1,`${name}: reappearing actions must receive a fresh image`);
    assert.equal(visual.displayedSessions.get(hidden.id),'A');
    const nextArtworkStarted=new Promise(resolve=>{startedArtwork=resolve;});
    driver.artwork=()=>{driver.artwork=undefined;startedArtwork();return new Promise(resolve=>{releaseArtwork=resolve;});};
    visual.refresh();await nextArtworkStarted;
    visual.onWillDisappear({action:hidden});
    const replacement={...long,session_id:'B',title:'Replacement track'};
    driver.current=replacement;driver.sessions=[long,replacement];
    await visual.onWillAppear({action:hidden,payload:{settings:{mediaTarget:'B'}}});
    releaseArtwork();
    while(visual.refreshing) await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(sent.length,2,`${name}: reusing the same action ID must discard its previous render`);
    assert.equal(visual.displayedSessions.get(hidden.id),'B');
    visual.onWillDisappear({action:hidden});
    visual.actions=originalActions;
  }
  delete globalThis.__mediaTest;
});
