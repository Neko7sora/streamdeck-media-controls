import {playbackPosition, type MediaItem} from "./media-model.js";

export function trackIdentity(media: MediaItem): string {
  return JSON.stringify([media.session_id, media.title, media.artist, media.album, media.track_number,
    media.source === "chrome" ? media.browser_media?.target_id : undefined]);
}

/** Clamp to the provider's actual seekable ranges, including gaps in browser media. */
export function seekPosition(media: MediaItem | null, position: number): number {
  const t = media?.timeline;
  if (!media?.controls?.seek || !Number.isFinite(position) || t?.min_seek_sec == null ||
      t.max_seek_sec == null || !Number.isFinite(t.min_seek_sec) || !Number.isFinite(t.max_seek_sec) ||
      t.max_seek_sec <= t.min_seek_sec) throw new Error("Seek unavailable");
  const ranges = media.source === "chrome" && media.browser_media?.seekable_ranges?.length
    ? media.browser_media.seekable_ranges : [[t.min_seek_sec, t.max_seek_sec]];
  let nearest: number | undefined;
  for (const [start, end] of ranges) {
    if (start === undefined || end === undefined) continue;
    const candidate = Math.max(start, Math.min(end, position));
    if (nearest === undefined || Math.abs(position - candidate) < Math.abs(position - nearest)) nearest = candidate;
  }
  if (nearest === undefined) throw new Error("Seek unavailable");
  return nearest;
}

type PendingSeek = {
  track: string; sample: string; target: number; destination: number; touched: number; sent?: number; running?: Promise<void>;
};

/** Order touch and rotary seeks together; send only one seek per action at a time. */
export class DialSeeking {
  private readonly pending = new Map<string, PendingSeek>();
  private readonly running = new Map<string, Promise<void>>();

  clear(id: string): void {this.pending.delete(id);}

  rotate(id: string, media: MediaItem | null, delta: number,
    send: (position: number) => Promise<void>, now = Date.now()): Promise<void> {
    return this.move(id, media, delta, true, send, now);
  }

  seekTo(id: string, media: MediaItem | null, position: number,
    send: (position: number) => Promise<void>, now = Date.now()): Promise<void> {
    return this.move(id, media, position, false, send, now);
  }

  private async move(id: string, media: MediaItem | null, value: number, relative: boolean,
    send: (position: number) => Promise<void>, now: number): Promise<void> {
    if (!media || !Number.isFinite(value)) throw new Error("Seek unavailable");
    const position = relative ? playbackPosition(media, now) : value;
    if (position === null) throw new Error("Playback position unavailable");
    const track = trackIdentity(media);
    // observed_at changes on every poll, even when GSMTC's actual sample is unchanged.
    // A paused browser also timestamps identical positions on every heartbeat.
    const timeline = media.source === "chrome" && media.playback_state === "paused" && media.timeline
      ? {...media.timeline, updated_at: undefined} : media.timeline;
    const sample = JSON.stringify([timeline, media.playback_state, media.playback_rate, media.browser_media?.seekable_ranges]);
    let state = this.pending.get(id);
    // A tap replaces waiting ticks, but still waits for the in-flight command.
    if (!relative || !state || state.track !== track || (!state.running && (state.sample !== sample || now - state.touched > 2000))) {
      state = {track, sample, target: position, destination: position, touched: now};
    }
    const requested = relative ? state.target + value : value;
    const destination = seekPosition(media, requested);
    this.pending.set(id, state);
    // A sample already seen during this gesture must not reset the accumulated
    // target after the in-flight command completes.
    state.sample = sample;
    state.destination = destination;
    // Keep accumulated time inside a gap so small ticks can reach the next range.
    // Only the outer bounds discard overshoot, allowing an immediate reversal.
    state.target = Math.max(media.timeline!.min_seek_sec!, Math.min(media.timeline!.max_seek_sec!, requested));
    state.touched = now;
    if (state.running) return state.running;
    if (state.sent === destination) return;
    const current = state;
    const previous = this.running.get(id);
    const operation = (async () => {
      // A replaced or cleared target can still have an in-flight command.
      // Wait for it without carrying its failure into the new target.
      if (previous) {try {await previous;} catch {}}
      try {
        let sent: number;
        do {
          if (this.pending.get(id) !== current) return;
          sent = current.destination;
          await send(sent);
          current.sent = sent;
        } while (current.destination !== sent);
      } catch (error) {
        if (this.pending.get(id) === current) this.pending.delete(id);
        throw error;
      }
    })();
    current.running = operation;
    this.running.set(id, operation);
    try {await operation;}
    finally {
      current.running = undefined;
      if (this.running.get(id) === operation) this.running.delete(id);
    }
  }
}
