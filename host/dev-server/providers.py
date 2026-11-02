"""Host-side data providers for the Orbit Desktop dev server.

Each provider runs in a daemon thread, keeps its latest value in memory and
never blocks HTTP handlers. Providers only *read* local state (ps, vm_stat,
netstat, AppleScript to already-running players, JSON files written by the
helpers) plus the few explicitly configured network calls (Open-Meteo, and
opt-in: ipinfo.io, iTunes Search, networkQuality). The extra panels (mac, network,
iss, quakes, ...) live in providers_extra.py.

Nothing here is personal: ping targets, location, file paths all come from
layout.yaml (`providers:`).
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from orbit_config import CACHE_DIR
from providers_extra import ExtraLoops

UA = "OrbitDesktop/0.1 (local dev server)"


def sh(cmd, timeout=10):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""


def osa(script, timeout=5):
    try:
        r = subprocess.run(["/usr/bin/osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
        return r.stdout.rstrip("\r\n")  # keep trailing tabs: an empty last field must survive
    except Exception:
        return ""


def http_get(url, timeout=10, limit=10_000_000):
    if not url.startswith("https://"):
        return b""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(limit)


def read_small(path, limit=2_000_000):
    try:
        with open(os.path.expanduser(path), "rb") as f:
            return f.read(limit)
    except (OSError, TypeError):
        return None


# Fields of the `system` signal a native host app may supply (see --host-dir in orbit_server.py).
HOST_SYSTEM_FIELDS = ("cpu", "load", "mem", "disk", "net")
HOST_FRESH_SECONDS = 10


class Providers(ExtraLoops):
    sh = staticmethod(sh)
    http_get = staticmethod(http_get)

    def __init__(self, cfg: dict, host_dir: str | None = None):
        self.cfg = cfg
        # When the Swift host app runs us, it measures system stats, audio and calendar natively
        # and drops them as JSON files into host_dir. We then skip our own subprocess-based loops.
        self.host_dir = host_dir
        self.lock = threading.Lock()
        self.system = {"cpu": None, "load": None, "mem": None, "disk": None, "net": None, "ping": {}, "speed": None,
                       "ts": 0}
        self.now = {"state": "stopped", "source": "", "key": "", "title": "", "artist": "", "album": "",
                    "position": 0, "duration": 0, "hasArt": False, "ts": 0}
        self.art = {"key": "", "bytes": b"", "type": "image/jpeg"}
        self.location = None
        self.weather = None
        self.claude = None
        self.extra = {}            # generic signals (orbit_config.GENERIC_SIGNALS): name -> latest JSON value
        self._mac = None           # mac_loop / active_loop halves of the `mac` signal
        self._active = None
        self._remote_art_cache = {}
        os.makedirs(CACHE_DIR, exist_ok=True)

    # ------------------------------------------------------------------ lifecycle
    def start(self):
        p = self.cfg
        loops = [self.location_loop] if self.host_dir else [self.fast_loop, self.disk_loop, self.location_loop]
        if p["ping"]["targets"] or p["ping"]["external_file"]:
            loops.append(self.ping_loop)
        if p["speedtest"]["enabled"]:
            loops.append(self.speed_loop)
        if p["now_playing"]["enabled"]:
            loops.append(self.player_loop)
        if p["weather"]["enabled"]:
            loops.append(self.weather_loop)
        if p["claude_usage"]["enabled"]:
            loops.append(self.claude_loop)
        loops += self.extra_loops()
        for fn in loops:
            threading.Thread(target=self._guard(fn), daemon=True, name=fn.__name__).start()

    @staticmethod
    def _guard(fn):
        def run():
            while True:
                try:
                    fn()
                except Exception as e:  # never let a provider thread die silently
                    print(f"[orbit] provider {fn.__name__} crashed: {e!r}; restarting in 10s", flush=True)
                    time.sleep(10)
        return run

    # ------------------------------------------------------------------ system
    def _iface(self):
        name = self.cfg["system"]["interface"]
        if name and name != "auto":
            return name
        for line in sh(["/sbin/route", "-n", "get", "default"], timeout=3).splitlines():
            line = line.strip()
            if line.startswith("interface:"):
                return line.split(":", 1)[1].strip()
        return "en0"

    def _iface_bytes(self, name):
        for line in sh(["/usr/sbin/netstat", "-ibn"]).splitlines():
            f = line.split()
            if len(f) >= 10 and f[0] == name and f[2].startswith("<Link"):
                try:
                    return int(f[6]), int(f[9])
                except ValueError:
                    return None
        return None

    def fast_loop(self):
        iface, iface_at = self._iface(), time.time()
        prev, pt = self._iface_bytes(iface), time.time()
        ncpu = os.cpu_count() or 1
        page = int(sh(["/usr/sbin/sysctl", "-n", "hw.pagesize"]) or 16384)
        total = int(sh(["/usr/sbin/sysctl", "-n", "hw.memsize"]) or 0)
        while True:
            time.sleep(2)
            if time.time() - iface_at > 60:  # follow Wi-Fi <-> Ethernet switches
                new = self._iface()
                if new != iface:
                    iface, prev = new, None
                iface_at = time.time()
            cur, t = self._iface_bytes(iface), time.time()
            net = None
            if prev and cur:
                dt = t - pt
                net = {"rx": max(0.0, (cur[0] - prev[0]) / dt), "tx": max(0.0, (cur[1] - prev[1]) / dt), "iface": iface}
            prev, pt = cur, t
            vals = [x for x in sh(["/bin/ps", "-A", "-o", "%cpu="]).split() if x.replace(".", "", 1).isdigit()]
            cpu = min(100.0, sum(float(x) for x in vals) / ncpu)
            vm = {}
            for line in sh(["/usr/bin/vm_stat"]).splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    v = v.strip().rstrip(".")
                    if v.isdigit():
                        vm[k.strip()] = int(v)
            used = (vm.get("Pages active", 0) + vm.get("Pages wired down", 0) + vm.get("Pages occupied by compressor", 0)) * page
            with self.lock:
                self.system.update(cpu=cpu, load=os.getloadavg()[0], net=net, ts=time.time(),
                                   mem={"used": used, "total": total, "pct": used / total * 100} if total else None)

    def disk_loop(self):
        while True:
            out = sh(["/usr/sbin/iostat", "-d", "-c", "2", "-w", "1"]).strip().splitlines()
            if out:
                f = out[-1].split()
                try:
                    with self.lock:
                        self.system["disk"] = {"mbs": sum(float(f[i]) for i in range(2, len(f), 3))}
                except (ValueError, IndexError):
                    pass
            time.sleep(4)

    @staticmethod
    def _tcp_ms(host, port):
        t0 = time.time()
        try:
            with socket.create_connection((host, port), timeout=2):
                return (time.time() - t0) * 1000
        except OSError:
            return None

    def ping_loop(self):
        p = self.cfg["ping"]
        while True:
            res = {}
            for tg in p["targets"]:
                ms = None
                if tg["method"] == "icmp":
                    for tok in sh(["/sbin/ping", "-c", "1", "-t", "2", "--", tg["host"]], timeout=4).split():
                        if tok.startswith("time="):
                            try:
                                ms = float(tok[5:])
                            except ValueError:
                                pass
                if ms is None:  # host may drop ICMP: fall back to TCP connect time
                    ms = self._tcp_ms(tg["host"], tg["port"])
                res[tg["name"]] = ms
            # Optional: results written by host/helpers/tcp-latency.sh (macOS Local Network privacy can
            # block Python from reaching LAN hosts; a helper run from a permitted context can).
            if p["external_file"]:
                raw = read_small(p["external_file"], 64_000)
                try:
                    j = json.loads(raw or b"{}")
                    fresh = time.time() - float(j.get("ts", 0)) < 4 * p["interval_seconds"] + 30
                    for k, v in (j.get("targets") or {}).items():
                        res[str(k)[:24]] = float(v) if (fresh and isinstance(v, (int, float))) else None
                except (ValueError, TypeError, AttributeError):
                    pass
            with self.lock:
                self.system["ping"] = res
            time.sleep(p["interval_seconds"])

    def speed_loop(self):
        """macOS networkQuality on a timer (uses real bandwidth; optionally skipped on battery)."""
        cfg = self.cfg["speedtest"]
        cache = os.path.join(CACHE_DIR, "speedtest.json")
        interval = cfg["interval_minutes"] * 60
        try:
            with open(cache) as f:
                last = json.load(f)
            with self.lock:
                self.system["speed"] = last
            wait = max(0, interval - (time.time() - last["at"]))
        except Exception:
            wait = 0
        time.sleep(wait)
        while True:
            if not cfg["only_on_ac_power"] or "AC Power" in sh(["/usr/bin/pmset", "-g", "batt"]):
                try:
                    j = json.loads(sh(["/usr/bin/networkQuality", "-c", "-s"], timeout=90) or "{}")
                    if j.get("dl_throughput"):
                        sp = {"dl": j["dl_throughput"] / 1e6, "ul": j.get("ul_throughput", 0) / 1e6, "at": time.time()}
                        with self.lock:
                            self.system["speed"] = sp
                        with open(cache, "w") as f:
                            json.dump(sp, f)
                except ValueError:
                    pass
            time.sleep(interval)

    # ------------------------------------------------------------------ now playing
    MUSIC_SCRIPT = r'''
if application "Music" is running then
  tell application "Music"
    set ps to player state as text
    if ps is "playing" or ps is "paused" then
      set t to current track
      return ps & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & (player position as text) & tab & (duration of t as text) & tab & ""
    end if
  end tell
end if
return "stopped"
'''
    SPOTIFY_SCRIPT = r'''
if application "Spotify" is running then
  tell application "Spotify"
    set ps to player state as text
    if ps is "playing" or ps is "paused" then
      set t to current track
      return ps & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & (player position as text) & tab & ((duration of t) / 1000 as text) & tab & (artwork url of t)
    end if
  end tell
end if
return "stopped"
'''
    ART_SCRIPT = r'''
tell application "Music"
  if (count of artworks of current track) is 0 then return "none"
  set d to raw data of artwork 1 of current track
end tell
set f to open for access (POSIX file "%s") with write permission
set eof f to 0
write d to f
close access f
return "ok"
'''

    def _read_player(self, script, source):
        parts = osa(script).split("\t")
        if len(parts) != 7:
            return None
        st, title, artist, album, pos, dur, art_url = parts
        try:
            pos, dur = float(pos.replace(",", ".")), float(dur.replace(",", "."))
        except ValueError:
            pos, dur = 0.0, 0.0
        return {"state": st, "source": source, "title": title, "artist": artist, "album": album,
                "position": pos, "duration": dur, "art_url": art_url}

    @staticmethod
    def _sniff(b):
        if b[:8] == b"\x89PNG\r\n\x1a\n":
            return "image/png"
        return "image/jpeg"

    def _itunes_art(self, artist, album, title):
        """Opt-in fallback for streamed tracks: iTunes Search API artwork."""
        k = (artist, album)
        if k in self._remote_art_cache:
            return self._remote_art_cache[k]
        data = b""
        country = self.cfg["now_playing"]["itunes_country"]
        for term, entity in ((f"{artist} {album}", "album"), (f"{artist} {title}", "song")):
            try:
                q = urllib.parse.urlencode({"term": term, "entity": entity, "limit": 1, "country": country})
                res = json.loads(http_get(f"https://itunes.apple.com/search?{q}", timeout=6)).get("results", [])
                if res and res[0].get("artworkUrl100"):
                    data = http_get(res[0]["artworkUrl100"].replace("100x100bb", "1200x1200bb"))
                    break
            except Exception:
                continue
        self._remote_art_cache[k] = data
        return data

    def _update_art(self, key, p):
        data = b""
        if p["source"] == "spotify":
            try:
                data = http_get(p["art_url"]) if p["art_url"].startswith("https://i.scdn.co/") else b""
            except Exception:
                data = b""
        else:
            tmp = os.path.join(CACHE_DIR, "artwork.bin")
            if osa(self.ART_SCRIPT % tmp, timeout=8) == "ok":
                data = read_small(tmp, 20_000_000) or b""
        if len(data) < 1000 and self.cfg["now_playing"]["itunes_artwork_fallback"]:
            data = self._itunes_art(p["artist"], p["album"], p["title"])
        with self.lock:
            self.art.update(key=key, bytes=data, type=self._sniff(data) if data else "image/jpeg")
            if self.now["key"] == key:
                self.now["hasArt"] = bool(data)

    def player_loop(self):
        scripts = {"music": self.MUSIC_SCRIPT, "spotify": self.SPOTIFY_SCRIPT}
        while True:
            players = [x for x in (self._read_player(scripts[n], n) for n in self.cfg["now_playing"]["players"]) if x]
            players.sort(key=lambda x: x["state"] != "playing")  # a playing source wins over a paused one
            if players:
                p = players[0]
                key = hashlib.sha1(f"{p['source']}|{p['title']}|{p['artist']}|{p['album']}".encode()).hexdigest()[:12]
                changed = key != self.art["key"]
                with self.lock:
                    self.now.update({k: v for k, v in p.items() if k != "art_url"}, key=key, ts=time.time(),
                                    hasArt=bool(self.art["bytes"]) and self.art["key"] == key)
                if changed:
                    self.record_recent(p)
                    self._update_art(key, p)
            else:
                with self.lock:
                    self.now.update(state="stopped", ts=time.time())
            time.sleep(2)

    # ------------------------------------------------------------------ location / weather
    def _locate(self):
        c = self.cfg["location"]
        fixed = {"lat": c["lat"], "lon": c["lon"], "name": c["name"], "source": "config"}
        if c["mode"] == "corelocation" and c.get("corelocation_cli") and os.path.isfile(c["corelocation_cli"]):
            out = sh([c["corelocation_cli"], "-once", "-format", "%latitude\t%longitude\t%locality\t%administrativeArea"], timeout=20).strip()
            parts = out.split("\t")
            if len(parts) == 4:
                try:
                    name = " · ".join(x for x in parts[2:] if x and x != "(null)").upper() or c["name"]
                    return {"lat": float(parts[0]), "lon": float(parts[1]), "name": name, "source": "corelocation"}
                except ValueError:
                    pass
        if c["mode"] == "ip":
            try:
                j = json.loads(http_get("https://ipinfo.io/json", timeout=8))
                lat, lon = (float(x) for x in j["loc"].split(","))
                return {"lat": lat, "lon": lon, "name": f"{j.get('city', '')} · {j.get('region', '')}".upper(), "source": "ip"}
            except Exception:
                pass
        return fixed

    def location_loop(self):
        while True:
            loc = self._locate()
            with self.lock:
                self.location = loc
            time.sleep(1800 if self.cfg["location"]["mode"] != "fixed" else 86400)

    WEATHER_KEYS = ("current", "current_units", "hourly", "hourly_units", "daily", "daily_units", "minutely_15",
                    "minutely_15_units", "timezone", "timezone_abbreviation", "utc_offset_seconds", "elevation")

    def weather_loop(self):
        """Open-Meteo (no API key, CC BY 4.0 - attribution shown by the weather widget): forecast, plus
        optionally surface pressure (past 12 h + next 24 h) and air quality, as sub-keys `pressure` / `air`."""
        c = self.cfg["weather"]
        while True:
            loc = self.location
            if not loc:
                time.sleep(1)
                continue
            ll = {"latitude": f"{loc['lat']:.2f}", "longitude": f"{loc['lon']:.2f}"}  # ~1 km: enough for weather
            q = urllib.parse.urlencode({
                **ll,
                "current": "temperature_2m,weather_code,is_day",
                "hourly": "temperature_2m,weather_code,precipitation_probability",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                         "sunrise,sunset,uv_index_max",
                "minutely_15": "precipitation", "forecast_minutely_15": 8,
                "timezone": "auto", "forecast_days": 5, "forecast_hours": 12})
            try:
                w = json.loads(http_get("https://api.open-meteo.com/v1/forecast?" + q, timeout=10))
            except Exception:
                time.sleep(120)
                continue
            w = {k: w.get(k) for k in self.WEATHER_KEYS}
            w["place"] = loc["name"]
            w["place_src"] = loc.get("source")
            w["fetched"] = time.time()
            w["attribution"] = "Weather data by Open-Meteo.com (CC BY 4.0)"
            old = self.weather or {}
            w["pressure"], w["air"] = old.get("pressure"), old.get("air")
            if c["pressure"]:
                try:
                    pq = urllib.parse.urlencode({**ll, "hourly": "surface_pressure", "past_hours": 12,
                                                 "forecast_hours": 24, "timezone": "auto"})
                    h = json.loads(http_get("https://api.open-meteo.com/v1/forecast?" + pq, timeout=10)).get("hourly") or {}
                    if h.get("time") and h.get("surface_pressure"):
                        w["pressure"] = {"time": h["time"], "hpa": h["surface_pressure"], "at": time.time()}
                except Exception:
                    pass
            else:
                w["pressure"] = None
            if c["air"]:
                try:
                    aq = urllib.parse.urlencode({**ll, "current": "pm2_5,us_aqi"})
                    cur = json.loads(http_get("https://air-quality-api.open-meteo.com/v1/air-quality?" + aq,
                                              timeout=10)).get("current") or {}
                    w["air"] = {"pm25": cur.get("pm2_5"), "aqi": cur.get("us_aqi"), "at": time.time()}
                except Exception:
                    pass
            else:
                w["air"] = None
            with self.lock:
                self.weather = w
            time.sleep(c["refresh_minutes"] * 60)

    # ------------------------------------------------------------------ unofficial: Claude usage
    def claude_loop(self):
        """UNOFFICIAL. Reads the undocumented `cachedUsageUtilization` field Claude Code keeps in
        ~/.claude.json. Only enabled with providers.claude_usage.enabled: true. Only the usage
        percentages and reset times leave this function - nothing else from that file."""
        keys = ("five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "seven_day_fable")
        while True:
            try:
                with open(os.path.expanduser("~/.claude.json"), "rb") as f:
                    u = json.loads(f.read(20_000_000)).get("cachedUsageUtilization") or {}
                rows = []
                for k, v in (u.get("utilization") or {}).items():
                    if k in keys and isinstance(v, dict) and isinstance(v.get("utilization"), (int, float)):
                        rows.append({"key": k, "pct": v["utilization"], "resets": v.get("resets_at")})
                with self.lock:
                    self.claude = {"rows": rows, "fetched": (u.get("fetchedAtMs") or 0) / 1000}
            except (OSError, ValueError, AttributeError):
                pass
            time.sleep(30)

    # ------------------------------------------------------------------ accessors (JSON-safe copies)
    def get(self, name):
        with self.lock:
            if name == "system":
                out = json.loads(json.dumps(self.system))
                if self.host_dir:
                    out.update(self._host_system())
                return out
            if name == "nowPlaying":
                return dict(self.now)
            if name == "location":
                return dict(self.location) if self.location else None
            if name == "weather":
                return self.weather
            if name == "claudeUsage":
                return self.claude
            if name == "alerts":
                return self._host_alerts()
            if name in self.extra:
                return json.loads(json.dumps(self.extra[name]))
        return None

    def set_extra(self, name, value):
        with self.lock:
            self.extra[name] = value

    def _host_alerts(self):
        """EEW / tsunami state written by the host app (host_dir/alerts.json). Stale file -> no alerts."""
        empty = {"eew": None, "tsunami": None, "ws": None}
        if not self.host_dir:
            return empty
        try:
            j = json.loads(read_small(os.path.join(self.host_dir, "alerts.json"), 512_000) or b"{}")
            if time.time() - float(j.get("ts", 0)) < 15:
                return j
        except (ValueError, TypeError, AttributeError):
            pass
        return empty

    def artwork(self):
        with self.lock:
            if self.art["bytes"] and self.art["key"] == self.now["key"]:
                return self.art["bytes"], self.art["type"]
        return None, None

    def _host_system(self):
        """System fields written by the host app (host_dir/system.json), or nulls if stale."""
        try:
            j = json.loads(read_small(os.path.join(self.host_dir, "system.json"), 64_000) or b"{}")
            if time.time() - float(j.get("ts", 0)) < HOST_FRESH_SECONDS:
                return {k: j.get(k) for k in HOST_SYSTEM_FIELDS + ("ts",)}
        except (ValueError, TypeError, AttributeError):
            pass
        return {k: None for k in HOST_SYSTEM_FIELDS}

    def calendar_bytes(self):
        path = os.path.join(self.host_dir, "calendar.json") if self.host_dir else self.cfg["calendar"]["file"]
        return read_small(path) or b'{"events": []}'

    def audio_path(self):
        if self.host_dir:
            return os.path.join(self.host_dir, "audio.json")
        return os.path.expanduser(self.cfg["audio"]["file"])
