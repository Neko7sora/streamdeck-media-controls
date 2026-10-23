import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL("../dev.n7s.media-controls.sdPlugin/ui/settings.js",import.meta.url),"utf8");
const localization=readFileSync(new URL("../dev.n7s.media-controls.sdPlugin/ui/localization.js",import.meta.url),"utf8");
export const displayFields={"show-title":"showTitle","show-artist":"showArtist","show-artwork":"showArtwork","show-app-icon":"showAppIcon","show-status":"showStatus","show-position":"showPosition","show-duration":"showDuration","show-progress":"showProgress","show-dial-info":"showDialInfo","show-control-icon":"showControlIcon","show-target":"showTarget","show-scope":"showScope","show-volume":"showVolume","show-volume-bar":"showVolumeBar"};
const displayGroups=["control-icon-setting","scope-setting","target-setting","title-setting","artist-setting","artwork-setting","app-icon-setting","volume-setting","status-setting","volume-bar-setting","control-display-note","title-label","status-label","target-warning"];
export function inspector(settings={},{connect=true,language="ja",sourceText=source,action="dev.n7s.media-controls.now-playing-dial"}={}) {
  const selects=new Set(["media","audio","dial-mode","seek-step"]);
  const elements=new Map();
  for(const id of ["action-heading","appearance-settings","display-summary","show-all","chrome-setup","chrome-setup-link","chrome-setup-summary","media","audio","media-settings","audio-settings","target-note","now-playing-help","scroll-help","scroll-text","global","global-settings","details","dial-mode","seek-step","dial-settings","seek-settings","status","register-chrome","chrome-registration-status","chrome-connection","chrome-connection-title","chrome-connection-detail","display-settings","dial-display-settings","progress-display-note",...displayGroups,...Object.keys(displayFields)]) {
    let value="";
    const element={dataset:{},children:[],listeners:{},checked:false,hidden:false,textContent:"",disabled:id==="register-chrome",
      get value(){return value;},
      set value(next){value=selects.has(id)&&!this.children.some(option=>option.value===next)?"":next;},
      replaceChildren(){this.children=[];value="";},
      append(option){this.children.push(option);if(this.children.length===1) value=option.value;},
      focus(){this.focused=true;},
      addEventListener(event,fn){this.listeners[event]=fn;}
    };
    elements.set(id,element);
  }
  for(const [id,values] of [["dial-mode",["seek","volume"]],["seek-step",["1","5","10","30","60"]]]) {
    for(const value of values) elements.get(id).append({value});
  }
  const messages=[];
  const timers=new Map();let timerId=0;
  let socket,poll,now=1000;
  class WebSocket {
    static OPEN=1;
    readyState=0;
    constructor(){socket=this;}
    send(message){messages.push(JSON.parse(message));}
  }
  const window={};
  vm.runInNewContext(localization+'\n'+sourceText,{window,WebSocket,JSON,Date:{now:()=>now},crypto:{randomUUID},setInterval(fn){poll=fn;},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},document:{documentElement:{},querySelectorAll:()=>[],
    getElementById:id=>elements.get(id),createElement:()=>({})
  }});
  window.connectElgatoStreamDeckSocket(1234,"context","registerPropertyInspector",JSON.stringify({application:{language}}),JSON.stringify({
    action,payload:{settings}
  }));
  const open=()=>{socket.readyState=1;socket.onopen();};
  if(connect) open();
  return {elements,messages,open,poll:()=>{poll();return messages.at(-1).payload;},
    advance(ms){now+=ms;poll();},
    click:id=>elements.get(id).listeners.click(),
    timeout(){for(const [id,fn] of timers){timers.delete(id);fn();}},
    close(){socket.readyState=3;socket.onclose();},
    receive:(event,payload)=>socket.onmessage({data:JSON.stringify({event,payload})}),
    change(id,value){const element=elements.get(id);if(id==="global"||id==="scroll-text"||id in displayFields) element.checked=value;else element.value=value;element.listeners.change();}};
}

