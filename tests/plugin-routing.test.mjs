import {test} from "node:test";
import assert from "node:assert/strict";
import {load} from "./load.mjs";
test("Now Playing operates the session last sent to the display, and never falls back after removal",async()=>{
  const a={source:"windows",session_id:"A",title:"Track",controls:{toggle:true}},b={...a,session_id:"B"};
  const driver={instances:[],commands:[],audioRequests:[],current:a,sessions:[a,b]};globalThis.__mediaTest=driver;
  const mocks={
    sdk:`const d=globalThis.__mediaTest;export class SingletonAction{actions=[];} export function action(){return c=>c;} export default {actions:{registerAction(a){d.instances.push(a);}},ui:{onSendToPlugin(){}},logger:{warn(){},error(){},info(){}},async connect(){}};`,
    state:`const d=globalThis.__mediaTest;export function currentMedia(id="auto"){return id==="auto"?d.current:d.sessions.find(x=>x.session_id===id)??null;}export function availableSessions(){return d.sessions;}export function audioTarget(id){d.audioRequests.push(id);return {name:id,volume:0.5,muted:false};}export function audioTargets(){return [];}export function subscribe(){}export function startMediaPolling(){return ()=>{};}`,
    native:`export async function nativeCommand(c){globalThis.__mediaTest.commands.push(c);}`,
    chrome:`export function startChromeServer(){return {close(){},closeAllConnections(){}};}export async function chromeCommand(){throw Error("Unexpected Chrome command");}`,
    art:`export async function artwork(){return undefined;}`
  };
  const plugin={name:"test-ports",setup(build){
    build.onResolve({filter:/@elgato\/streamdeck$|\.\/media-state\.js$|\.\/native-client\.js$|\.\/chrome-server\.js$|\.\/artwork\.js$/},args=>({path:args.path==="@elgato/streamdeck"?"sdk":args.path.includes("media-state")?"state":args.path.includes("native-client")?"native":args.path.includes("chrome-server")?"chrome":"art",namespace:"test"}));
    build.onLoad({filter:/.*/,namespace:"test"},args=>({contents:mocks[args.path],loader:"js"}));
  }};
  await load("plugin",[plugin]);
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
  await rotate(1,{dialMode:"volume",audioTarget:"per-app"});
  assert.deepEqual(driver.commands.at(-1),{command:"volume",target:"per-app",delta:0.02});
  const before=driver.commands.length,previousAlerts=alerts;
  driver.sessions=[b];await rotate(1);
  assert.equal(driver.commands.length,before);assert.equal(alerts,previousAlerts+1);
  driver.sessions=[{...seekMedia,controls:{toggle:true}}];await rotate(1);
  assert.equal(driver.commands.length,before);assert.equal(alerts,previousAlerts+2);
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
  delete globalThis.__mediaTest;
});
