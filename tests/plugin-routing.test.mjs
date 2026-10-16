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
  await new Promise(resolve=>setTimeout(resolve,10));
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
      async setImage(){},async setTitle(){await send();},async setFeedback(){await send();},async showAlert(){alerts++;}};
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
  delete globalThis.__mediaTest;
});
