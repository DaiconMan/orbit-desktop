/**
 * Orbit Desktop plugin SDK — type definitions (reference only; plugins are plain JavaScript, no build step).
 *
 * A plugin's widget.js runs inside a sandboxed iframe (opaque origin, CSP `default-src 'none'`): no network,
 * no storage, no eval, no navigation. The only channel is the SDK below. Data arrives as "signals" the
 * manifest (widget.yaml) lists in `needs:`; payload contracts are in schemas/signals/<name>.schema.json.
 *
 * Global: `Orbit` (frozen). Entry points: `Orbit.widget(def)` for widgets, `Orbit.background(def)` for backgrounds.
 */

/** Signal names a manifest may list in `needs:` (see schemas/signals/index.json). */
type SignalName =
  | 'time' | 'system' | 'audio' | 'nowPlaying' | 'calendar' | 'weather' | 'location' | 'claudeUsage'
  | 'mac' | 'network' | 'alerts' | 'iss' | 'quakes' | 'holidays' | 'fx' | 'news' | 'bluetooth'
  | 'onthisday' | 'launches' | 'kp' | 'recent' | 'contrib' | 'github' | 'sessions' | 'rfc' | 'cloud' | 'power';

/** Actions a widget's own buttons may ask the host app to run; the manifest must declare them in `actions:`. */
type WidgetActionType = 'music' | 'mount';

interface OrbitTheme {
  font: string;            // CSS font-family list (also as var(--font))
  mono_font: string;       // var(--mono)
  accent: string;          // 'auto' or a colour
  text_color: string;      // var(--fg)
  locale: string;          // BCP-47, e.g. 'ja-JP'
  hour12: boolean;
  night_dim: boolean;
  /** three accent colours as "r,g,b" (also CSS vars --a --b --c; use rgb(var(--c))). Follows the album artwork when accent is 'auto'. */
  palette: { a: string; b: string; c: string };
}

interface OrbitContext<S = Record<string, any>> {
  /** plugin id (folder name) */
  readonly id: string;
  readonly kind: 'widget' | 'background';
  /** the element to render into (#orbit-root). Auto-sized widgets: the frame follows its size. */
  readonly root: HTMLElement;
  /** settings from the manifest defaults merged with the layout / editor (frozen) */
  readonly settings: Readonly<S>;
  readonly theme: OrbitTheme;
  /** theme.locale and its language ('ja', 'en', …) */
  readonly locale: string;
  readonly lang: string;
  readonly hour12: boolean;
  /** the HOST screen size in CSS px (inside the frame, vh/vw refer to the frame: use var(--vh) / var(--vw)) */
  readonly viewport: { w: number; h: number };
  /** content scale set in the layout editor (1 = 100 %); --vh / --vw already include it */
  readonly scale: number;
  /** parsed manifest `assets:` (path -> JSON object or text) */
  readonly assets: Record<string, any>;
  /** latest value of every needed signal */
  readonly signals: Partial<Record<SignalName, any>>;
  /** HTML-escape untrusted text (calendar titles, track names, …) before using innerHTML */
  esc(s: unknown): string;
  /** palette slot as "r,g,b" */
  rgb(k: 'a' | 'b' | 'c'): string;
  /** show / hide the widget; a hidden widget takes no space (e.g. nothing to show right now) */
  visible(on: boolean): void;
  /** ask the host app to run an action declared in the manifest's `actions:` */
  action(type: WidgetActionType, value: string): void;
}

interface WidgetDefinition<S = Record<string, any>> {
  /** called once after the init message (settings, theme, assets are ready) */
  mount?(ctx: OrbitContext<S>): void;
  /** one handler per needed signal; called on every update (also once with the latest value after mount) */
  on?: Partial<Record<SignalName, (data: any, ctx: OrbitContext<S>) => void>>;
  /** theme / screen / scale changed */
  theme?(ctx: OrbitContext<S>): void;
}

interface BackgroundContext<S = Record<string, any>> extends OrbitContext<S> {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** canvas pixel ratio (default 1: background drawing at 1x is the perf budget) and size in canvas px */
  DPR: number; W: number; H: number;
}
interface BackgroundFrame {
  t: number;  // seconds since start
  dt: number; // seconds since the last frame (≤ 0.1)
  /** normalised 0..1 levels computed by the SDK: cpu, net, audio.{level,bass,mid,high,bands[16]} */
  levels: { cpu: number; net: number; audio: { level: number; bass: number; mid: number; high: number; bands: number[] } };
  /** hook -> 0..1 from the layout's `react:` mapping (e.g. twinkle, meteors, glow) */
  react: Record<string, number>;
  signals: Partial<Record<SignalName, any>>;
}
interface BackgroundDefinition<S = Record<string, any>> {
  /** frames per second cap (settings.fps wins); keep ≤ 20–30 */
  fps?: number;
  dpr?: number;
  setup?(ctx: BackgroundContext<S>): void;
  resize?(ctx: BackgroundContext<S>): void;
  frame?(ctx: BackgroundContext<S>, f: BackgroundFrame): void;
  on?: WidgetDefinition<S>['on'];
}

/** Shared helpers in the module look (Japanese-first, like the bundled widgets). */
interface OrbitUI {
  esc(s: unknown): string;
  /** 'たった今' / 'n分前' / 'n時間前' / 'n日前' for a unix time in seconds */
  agoTxt(unixSeconds: number): string;
  /** duration in ms -> 'n日 n時間' / 'n時間 n分' / 'n分' */
  dur(ms: number): string;
  ymd(d: Date): string;
  /** today 00:00 local */
  day0(): Date;
  /** `<div class="kv">` key / value row (HTML string; escape values yourself) */
  kv(k: string, v: string, cls?: string): string;
  /** `<div class="tile">` big value + label */
  tile(big: string, label: string, cls?: string, extra?: string): string;
  /** `<div class="meter">` 0..100 bar */
  meter(pct: number, color?: string): string;
  /** bytes/s -> 'n KB/s' / 'n MB/s' */
  fmtB(bytesPerSecond: number): string;
  /** JMA intensity codes (10..70) -> '1'..'7' (5弱 etc.) */
  SCALE: Record<number, string>;
  /** weekday names 日..土 */
  WD: string[];
  /** WMO weather code -> [emoji, Japanese label] */
  WMO(code: number): [string, string];
  /** days -> '今日' / '明日' / 'あさって' / 'あとn日' */
  dayWord(days: number): string;
  /** append a value to the sparkline history of the <canvas id=…> and redraw it (60 values kept) */
  spark(canvasId: string, value: number, max: number, color: string): void;
}

interface OrbitModule {
  /** the module element (.mod) */
  el: HTMLElement;
  /** body (.mb): put your content here */
  body: HTMLElement;
  /** right side of the header (.mx): a short status / time */
  meta: HTMLElement;
}

interface OrbitGlobal {
  readonly version: string;
  widget<S = Record<string, any>>(def: WidgetDefinition<S>): void;
  background<S = Record<string, any>>(def: BackgroundDefinition<S>): void;
  /** the shared module frame: eyebrow header (title · hairline · meta) + body, in the bundled widgets' look */
  module(ctx: OrbitContext, title: string, cls?: string): OrbitModule;
  ui: OrbitUI;
  /** low-level sparkline into a canvas element with your own history array */
  spark(canvas: HTMLCanvasElement, hist: number[], val: number, max: number, color: string, len?: number): number[];
}

declare const Orbit: OrbitGlobal;
