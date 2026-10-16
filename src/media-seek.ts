import {playbackPosition, type MediaItem} from "./media-model.js";

export function trackIdentity(media: MediaItem): string {
  return JSON.stringify([media.session_id, media.title, media.artist, media.album, media.track_number]);
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
  track: string; sample: string; target: number; touched: number; running?: Promise<void>;
};

/** Accumulate rapid ticks while a command is pending; send only one seek at a time. */
export class DialSeeking {
  private readonly pending = new Map<string, PendingSeek>();

  clear(id: string): void {this.pending.delete(id);}

  async rotate(id: string, media: MediaItem | null, delta: number,
    send: (position: number) => Promise<void>, now = Date.now()): Promise<void> {
    if (!media || !Number.isFinite(delta)) throw new Error("Seek unavailable");
    const position = playbackPosition(media, now);
    if (position === null) throw new Error("Playback position unavailable");
    const track = trackIdentity(media);
    // observed_at changes on every poll, even when GSMTC's actual sample is unchanged.
    const sample = JSON.stringify([media.timeline, media.playback_state, media.playback_rate]);
    let state = this.pending.get(id);
    if (!state || state.track !== track || (!state.running && (state.sample !== sample || now - state.touched > 2000))) {
      state = {track, sample, target: position, touched: now};
      this.pending.set(id, state);
    }
    state.target = seekPosition(media, state.target + delta);
    state.touched = now;
    if (state.running) return state.running;
    const current = state;
    current.running = (async () => {
      try {
        let sent: number;
        do {
          if (this.pending.get(id) !== current) return;
          sent = current.target;
          await send(sent);
        } while (current.target !== sent);
      } catch (error) {
        if (this.pending.get(id) === current) this.pending.delete(id);
        throw error;
      } finally {current.running = undefined;}
    })();
    return current.running;
  }
}
