// Elgato recommends no more than 10 visual updates per second per key / dial.
export const DISPLAY_UPDATE_INTERVAL_MS = 100;

// The timeline and progress bar share the bottom 35 px as one seek target.
export const SEEK_TOUCH_RECT = [0, 65, 200, 35] as const;
export function isSeekTouch(x:number,y:number):boolean {
  const [left,top,width,height]=SEEK_TOUCH_RECT;
  return x>=left&&x<left+width&&y>=top&&y<top+height;
}
