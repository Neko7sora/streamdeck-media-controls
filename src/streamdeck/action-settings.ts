import type {KeyAction,DialAction} from "@elgato/streamdeck";

export type Settings={mediaTarget?:string;audioTarget?:string;globalKeys?:boolean;dialMode?:string;seekStep?:number;scrollText?:boolean;
  showTitle?:boolean;showArtist?:boolean;showArtwork?:boolean;showAppIcon?:boolean;showStatus?:boolean;
  showPosition?:boolean;showDuration?:boolean;showProgress?:boolean;showDialInfo?:boolean;
  showControlIcon?:boolean;showTarget?:boolean;showScope?:boolean;showVolume?:boolean;showVolumeBar?:boolean};
export type Instance=KeyAction<Settings>|DialAction<Settings>;

export const UUID="dev.n7s.media-controls";
