import {createServer, type ServerOptions} from "node:https";
import type {IncomingMessage, ServerResponse} from "node:http";
import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {displayTitle, playbackPosition, safeImage, type MediaItem, type AudioTarget} from "./media-model.js";
import {seekPosition, trackIdentity} from "./media-seek.js";

export const ICUE_PORT = 39762;
export interface IcueBackend {
  media(target: string): MediaItem | null;
  sessions(): MediaItem[];
  audio(target: string): AudioTarget | null;
  audioTargets(): AudioTarget[];
  subscribe(callback: () => void): () => void;
  native(command: Record<string, string | number>): Promise<void>;
  chrome(media: MediaItem, command: string, position?: number): Promise<void>;
  chromeStatus(): unknown;
}
type View = {media: string; audio: string; track: string; audioIdentity: string; expires: number};
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const audioIdentity = (audio: AudioTarget | null) => hash(audio && [audio.id, audio.pid, audio.process_path]);
const track = (media: MediaItem | null) => hash(media && trackIdentity(media));
const equal = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Authenticated loopback only. Display receipts bind commands to the rendered target/track. */
export function startIcueServer(backend: IcueBackend, options: {token: string; tls: ServerOptions; port?: number; log?: (message: string) => void}) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error("Invalid iCUE bridge token");
  const diagnostics = new Map<string, number>();
  function diagnose(kind: string, detail = "") {
    if (!options.log || Date.now() - (diagnostics.get(kind) ?? 0) < 30000) return;
    diagnostics.set(kind, Date.now());
    options.log(`iCUE HTTPS ${kind}${detail ? ": " + detail : ""}`);
  }
  const clients = new Set<ServerResponse>();
  let pendingCommands = 0;
  const signature = (body: string) => createHmac("sha256", options.token).update(body).digest("base64url");
  function receipt(media: string, audio: string): string {
    const body = Buffer.from(JSON.stringify({media, audio, track: track(backend.media(media)),
      audioIdentity: audioIdentity(backend.audio(audio)), expires: Date.now() + 30000})).toString("base64url");
    return body + "." + signature(body);
  }
  function verify(value: unknown): View {
    if (typeof value !== "string" || value.length > 10000) throw new Error("stale_view");
    const [body, mac, extra] = value.split(".");
    if (!body || !mac || extra !== undefined || !equal(mac, signature(body))) throw new Error("stale_view");
    const view = JSON.parse(Buffer.from(body, "base64url").toString()) as View;
    if (!Number.isFinite(view.expires) || view.expires < Date.now()) throw new Error("stale_view");
    return view;
  }
  function snapshot(mediaTarget: string, audioTarget: string) {
    const media = backend.media(mediaTarget), audio = backend.audio(audioTarget);
    const sessions = backend.sessions().slice(0, 256);
    if (media?.session_id && !sessions.some(item => item.session_id === media.session_id)) sessions.push(media);
    return {event: "state", view: receipt(mediaTarget, audioTarget), now: Date.now(), mediaTarget, audioTarget,
      media: media ? {...media, artwork_data_url: safeImage(media.artwork_data_url),
        fallback_artwork_data_url: safeImage(media.fallback_artwork_data_url),
        app_icon_data_url: safeImage(media.app_icon_data_url), favicon_data_url: safeImage(media.favicon_data_url),
        artwork_candidates: undefined, position: playbackPosition(media)} : null,
      sessions: sessions.filter(item => item.session_id).map(item => ({id: item.session_id,
        name: `${item.app_id || item.source} · ${displayTitle(item)}`})),
      audio: audio && {id: audio.id, name: audio.name, volume: audio.volume, muted: audio.muted},
      audioTargets: backend.audioTargets().slice(0, 256).map(item => ({id: item.id, name: item.id === "master" ? "マスター音量" : item.name})),
      chrome: backend.chromeStatus()};
  }
  async function command(value: Record<string, unknown>) {
    const view = verify(value.view);
    const media = backend.media(view.media), audio = backend.audio(view.audio);
    const op = value.command;
    if (op === "volume" || op === "mute") {
      if (!audio || audioIdentity(audio) !== view.audioIdentity) throw new Error("stale_audio");
      if (op === "mute" && typeof audio.muted !== "boolean") throw new Error("unavailable");
      if (op === "volume" && (typeof audio.volume !== "number" || typeof value.value !== "number" ||
          !Number.isFinite(value.value) || value.value < 0 || value.value > 1)) throw new Error("unavailable");
      // Absolute values avoid drift when another widget/app changes volume after the snapshot.
      await backend.native({command: op, target: audio.id, ...(op === "volume" ? {value: Number(value.value)} : {})});
      return;
    }
    if (!media?.session_id || track(media) !== view.track) throw new Error("stale_view");
    if (typeof op !== "string" || !["play-pause", "stop", "previous", "next", "seek"].includes(op)) throw new Error("unavailable");
    const supported = op === "play-pause" ? media.controls?.toggle ||
      media.controls?.[media.playback_state === "playing" ? "pause" : "play"] : media.controls?.[op];
    if (!supported) throw new Error("unavailable");
    const position = op === "seek" && typeof value.value === "number" ? seekPosition(media, value.value) : undefined;
    if (op === "seek" && position === undefined) throw new Error("unavailable");
    if (media.source === "windows" || media.source === "macos") await backend.native({command: op, session_id: media.session_id,
      ...(position === undefined ? {} : {position})});
    else await backend.chrome(media, op, position);
  }
  const server = createServer({...options.tls, minVersion: "TLSv1.2"}, (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    const reply = (status: number, body: unknown) => {if (!res.writableEnded) res.writeHead(status).end(JSON.stringify(body));};
    const origin = req.headers.origin;
    const port = (server.address() as {port: number} | null)?.port;
    // QtWebEngine serializes iCUE's local widget origin as file://; ordinary
    // Chromium file pages use null. Only these exact local origins are allowed.
    const localOrigin = origin === "null" || origin === "file://";
    if (req.headers.host !== `127.0.0.1:${port}` || (origin !== undefined && !localOrigin)) {
      diagnose("origin rejected", JSON.stringify({origin:origin?.slice(0,160),host:req.headers.host?.slice(0,160)}));
      reply(403, {error: "origin"}); return;
    }
    if (localOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      const headers = String(req.headers["access-control-request-headers"] || "").toLowerCase().split(",").map(v => v.trim()).filter(Boolean);
      if (!["GET", "POST"].includes(String(req.headers["access-control-request-method"])) ||
          headers.some(header => !["authorization", "content-type"].includes(header))) {reply(403, {error: "preflight"}); return;}
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.writeHead(204).end(); return;
    }
    if (!equal(String(req.headers.authorization || ""), `Bearer ${options.token}`)) {diagnose("authentication rejected");reply(401, {error: "unauthorized"}); return;}
    const url = new URL(req.url || "/", "https://127.0.0.1");
    const media = url.searchParams.get("media") || "auto", audio = url.searchParams.get("audio") || "master";
    if (req.url!.length > 6000 || media.length > 2000 || audio.length > 2000) {reply(400, {error: "target"}); return;}
    if (req.method === "GET" && url.pathname === "/events") {
      diagnose("widget connected");
      if (clients.size >= 8) {reply(503, {error: "busy"}); return;}
      clients.add(res);
      res.setHeader("Content-Type", "application/x-ndjson"); res.writeHead(200); res.flushHeaders(); res.setTimeout(0);
      let closed = false, blocked = false, dirty = false;
      const send = () => {
        if (closed) return;
        if (blocked) {dirty = true; return;}
        dirty = false;
        const line = JSON.stringify(snapshot(media, audio)) + "\n";
        if (Buffer.byteLength(line) > 8_000_000) {res.destroy(); return;}
        if (!res.write(line)) {
          blocked = true;
          res.once("drain", () => {blocked = false; if (dirty) send();});
        }
      };
      // Coalesce native updates, and yield before reading state (expiry can notify recursively).
      let queued: NodeJS.Timeout | undefined;
      const queue = () => {queued ??= setTimeout(() => {queued = undefined; send();}, 50);};
      const unsubscribe = backend.subscribe(queue);
      const heartbeat = setInterval(send, 10000);
      res.on("close", () => {closed = true; clearTimeout(queued); clearInterval(heartbeat); unsubscribe(); clients.delete(res);});
      send(); return;
    }
    if (req.method !== "POST" || url.pathname !== "/command") {reply(404, {error: "not_found"}); return;}
    if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {reply(415, {error: "content_type"}); return;}
    if (pendingCommands >= 16) {reply(503, {error: "busy"}); return;}
    let size = 0, oversized = false; const parts: Buffer[] = [];
    req.on("error", () => res.destroy());
    req.on("data", (bytes: Buffer) => {
      size += bytes.length;
      if (size > 12000) {oversized = true; parts.length = 0; reply(413, {error: "too_large"}); req.destroy();}
      else if (!oversized) parts.push(bytes);
    });
    req.on("end", () => {
      if (oversized) return;
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(Buffer.concat(parts).toString());
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      } catch {reply(400, {error: "payload"}); return;}
      if (pendingCommands >= 16) {reply(503, {error: "busy"}); return;}
      pendingCommands++;
      void command(body).then(() => reply(200, {ok: true}), () => reply(409, {error: "unavailable_or_stale"}))
        .finally(() => {pendingCommands--;});
    });
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.timeout = 5000; server.maxConnections = 32;
  server.on("tlsClientError", error => diagnose("TLS client error", String((error as NodeJS.ErrnoException).code ?? error.name)));
  server.on("close", () => {for (const client of clients) client.destroy(); clients.clear();});
  server.listen(options.port ?? ICUE_PORT, "127.0.0.1");
  return server;
}
