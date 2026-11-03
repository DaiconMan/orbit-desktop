"""Extra data loops for the Orbit dev server (ported from the personal prototype).

Each loop fills one generic signal via `self.set_extra(name, value)`; the server serves it at
/api/signals/<path> (orbit_config.GENERIC_SIGNALS). Payload shapes follow docs/provider-api.md
and must not change without bumping the API version.

Privacy: every loop here that calls the network or reads personal data is off by default
(orbit_config.DEFAULT_PROVIDERS). Nothing personal (hosts, subnets, repos, shares) is hard-coded;
it all comes from `providers:` in layout.yaml.
"""
from __future__ import annotations

import base64
import datetime as dt
import email.utils
import glob
import ipaddress
import json
import os
import re
import shutil
import subprocess
import time
import urllib.parse
import xml.etree.ElementTree as ET

from orbit_config import CACHE_DIR

JST = dt.timezone(dt.timedelta(hours=9))
# JMA seismic intensity (shindo) -> P2PQuake scale code
SCALE_CODE = {"1": 10, "2": 20, "3": 30, "4": 40, "5弱": 45, "5強": 50, "6弱": 55, "6強": 60, "7": 70}
TAILSCALE_NET = ipaddress.ip_network("100.64.0.0/10")
GH_FALLBACK_DIRS = ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin")


def _load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _save_json(path, value):
    try:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError:
        pass


def _wiki_plain(t):
    t = re.sub(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", "", t)
    t = re.sub(r"\{\{仮リンク\|([^|}]*)[^}]*\}\}", r"\1", t)
    for _ in range(3):
        t = re.sub(r"\{\{[^{}]*\}\}", "", t)
    t = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"'{2,}|<[^>]+>", "", t)
    return " ".join(t.split())


class ExtraLoops:
    """Mixin for providers.Providers (uses self.cfg, self.lock, self.system, self.extra, set_extra,
    sh, http_get). `extra_loops()` returns the loop functions enabled by the config."""

    def extra_loops(self):
        p = self.cfg
        on = lambda k: p[k]["enabled"]  # noqa: E731
        loops = []
        if on("mac"):
            loops += [self.mac_loop] + ([self.active_loop] if p["mac"]["active"] else [])
        if on("network"):
            loops.append(self.link_loop)
        table = (("iss", self.iss_loop), ("quakes", self.quake_loop), ("holidays", self.holiday_loop),
                 ("fx", self.fx_loop), ("news", self.news_loop), ("bluetooth", self.bluetooth_loop),
                 ("onthisday", self.onthisday_loop), ("launches", self.launches_loop), ("kp", self.kp_loop),
                 ("contrib", self.contrib_loop), ("github", self.github_loop), ("sessions", self.sessions_loop),
                 ("rfc", self.rfc_loop), ("cloud", self.cloud_loop), ("power", self.power_loop))
        loops += [fn for k, fn in table if on(k)]
        if on("recent"):
            rec = _load_json(self._recent_cache())
            self.set_extra("recent", {"items": rec[: p["recent"]["max_items"]] if isinstance(rec, list) else []})
        return loops

    def _get_json(self, url, timeout=10):
        return json.loads(self.http_get(url, timeout=timeout))

    # ------------------------------------------------------------------ mac (+ active minutes)
    def _publish_mac(self):
        with self.lock:
            m = dict(self._mac or {})
            m["active"] = dict(self._active) if self._active else None
            self.extra["mac"] = m

    def mac_loop(self):
        """Battery, Time Machine, startup-disk space (every 30 s)."""
        while True:
            m = {}
            b = self.sh(["/usr/bin/pmset", "-g", "batt"])
            m["ac"] = "AC Power" in b
            mm = re.search(r"(\d+)%;\s*([^;]+);\s*([0-9:]+|\(no estimate\))?", b)
            if mm:
                m["batt"] = int(mm.group(1))
                m["batt_state"] = mm.group(2).strip()
                m["batt_left"] = mm.group(3) if mm.group(3) and ":" in mm.group(3) else None
            tm = self.sh(["/usr/bin/tmutil", "status"])
            m["tm_running"] = "Running = 1" in tm
            pm = re.search(r'Percent = "?([0-9.]+)', tm)
            m["tm_pct"] = (float(pm.group(1)) * 100 if float(pm.group(1)) <= 1 else float(pm.group(1))) if pm else None
            dates = re.findall(r'"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \+0000)"',
                               self.sh(["/usr/bin/defaults", "read", "/Library/Preferences/com.apple.TimeMachine"]))
            if dates:
                m["tm_last"] = max(dt.datetime.strptime(d, "%Y-%m-%d %H:%M:%S %z") for d in dates).timestamp()
            df = self.sh(["/bin/df", "-k", "/"]).splitlines()
            if len(df) > 1:
                f = df[1].split()
                try:
                    m["disk_total"], m["disk_free"] = int(f[1]) * 1024, int(f[3]) * 1024
                except (IndexError, ValueError):
                    pass
            self._mac = m
            self._publish_mac()
            time.sleep(30)

    def active_loop(self):
        """Minutes today with user input in the last 5 min (HIDIdleTime), sampled every 60 s; persisted."""
        cache = os.path.join(CACHE_DIR, "active.json")
        a = _load_json(cache) or {}
        if a.get("date") == time.strftime("%Y-%m-%d"):
            self._active = dict(a)
            self._publish_mac()
        while True:
            time.sleep(60)  # sample at the end of each minute (restarts never double-count)
            day = time.strftime("%Y-%m-%d")
            if a.get("date") != day:
                a = {"date": day, "minutes": 0}
            m = re.search(r'"HIDIdleTime" = (\d+)', self.sh(["/usr/sbin/ioreg", "-c", "IOHIDSystem", "-d", "4"]))
            if m:
                idle = int(m.group(1)) / 1e9
                if idle < 300:
                    a["minutes"] += 1
                a["idle"] = round(idle)
                self._active = dict(a)
                self._publish_mac()
                _save_json(cache, a)

    # ------------------------------------------------------------------ network (home / tailscale / mounts)
    def _ipv4s(self):
        """[(iface, ip)] for every IPv4 address (ifconfig order)."""
        out, cur = [], None
        for line in self.sh(["/sbin/ifconfig"]).splitlines():
            if line and not line[0].isspace():
                cur = line.split(":", 1)[0]
            elif line.strip().startswith("inet "):
                out.append((cur, line.split()[1]))
        return out

    def _ssid(self, iface):
        for line in self.sh(["/usr/sbin/ipconfig", "getsummary", iface], timeout=4).splitlines():
            line = line.strip()
            if line.startswith("SSID :"):
                return line.split(":", 1)[1].strip()
        return None

    def link_loop(self):
        """Tailscale = an interface holding a 100.64.0.0/10 address; home = an address inside
        providers.network.home_subnet (or the Wi-Fi SSID equals home_ssid); NAS shares = smbfs mounts
        by share name. Ping / speed come from the ping and speedtest providers."""
        c = self.cfg["network"]
        subnet = ipaddress.ip_network(c["home_subnet"], strict=False) if c["home_subnet"] else None
        while True:
            addrs = []
            for iface, a in self._ipv4s():
                try:
                    addrs.append((iface, ipaddress.ip_address(a)))
                except ValueError:
                    pass
            ts = next((str(a) for _, a in addrs if a in TAILSCALE_NET), None)
            lan = [(i, a) for i, a in addrs if not a.is_loopback and a not in TAILSCALE_NET and not a.is_link_local]
            if c["home_interface"] != "auto":
                lan = [(i, a) for i, a in lan if i == c["home_interface"]]
            home = None
            ip = str(lan[0][1]) if lan else None
            if subnet is not None:
                hit = next((a for _, a in lan if a in subnet), None)
                home = hit is not None
                ip = str(hit) if hit else ip
            if c["home_ssid"]:
                ifs = [c["home_interface"]] if c["home_interface"] != "auto" else sorted({i for i, _ in lan})
                home = bool(home) or any(self._ssid(i) == c["home_ssid"] for i in ifs)
            mounted = self.sh(["/sbin/mount"]).splitlines()
            mounts = {n: any(f"/{n} on " in ln and "smbfs" in ln for ln in mounted) for n in c["mounts"]}
            with self.lock:
                self.extra["network"] = {"home": {"home": home, "ip": ip}, "tailscale": {"up": bool(ts), "ip": ts},
                                         "mounts": mounts, "ping": dict(self.system.get("ping") or {}),
                                         "speed": self.system.get("speed")}
            time.sleep(c["interval_seconds"])

    # ------------------------------------------------------------------ public data feeds
    def iss_loop(self):
        """ISS position (wheretheiss.at, every 10 s); widgets compute alt/az for the observer."""
        while True:
            try:
                j = self._get_json("https://api.wheretheiss.at/v1/satellites/25544", timeout=8)
                self.set_extra("iss", {"lat": j["latitude"], "lon": j["longitude"], "alt": j["altitude"],
                                       "vis": j.get("visibility"), "ts": j.get("timestamp")})
            except Exception:
                pass
            time.sleep(10)

    def quake_loop(self):
        """P2P地震情報 (JMA earthquake reports, code 551) every 60 s: quakes within `hours` whose max
        intensity >= min_intensity. Newest report of each quake wins."""
        c = self.cfg["quakes"]
        min_sc, window = SCALE_CODE[str(c["min_intensity"])], c["hours"] * 3600
        while True:
            try:
                out, seen = [], set()
                for it in self._get_json("https://api.p2pquake.net/v2/history?codes=551&limit=10"):
                    eq = it.get("earthquake") or {}
                    try:
                        ts = dt.datetime.strptime(eq.get("time", ""), "%Y/%m/%d %H:%M:%S").replace(tzinfo=JST).timestamp()
                    except ValueError:
                        continue
                    sc = eq.get("maxScale") or -1
                    if ts in seen or time.time() - ts > window or sc < min_sc:
                        continue
                    seen.add(ts)
                    hy = eq.get("hypocenter") or {}
                    out.append({"ts": ts, "scale": sc, "place": hy.get("name") or "",
                                "mag": hy.get("magnitude") if (hy.get("magnitude") or -1) > 0 else None})
                self.set_extra("quakes", out)
            except Exception:
                pass
            time.sleep(60)

    def holiday_loop(self):
        """Public holidays (country JP: holidays-jp), daily: {upcoming: next 5, map: date -> name
        for about -40 .. +70 days}."""
        while True:
            try:
                j = self._get_json("https://holidays-jp.github.io/api/v1/date.json")
                today = time.strftime("%Y-%m-%d")
                lo = time.strftime("%Y-%m-01", time.localtime(time.time() - 40 * 86400))
                hi = time.strftime("%Y-%m-%d", time.localtime(time.time() + 70 * 86400))
                self.set_extra("holidays", {
                    "upcoming": [{"date": d, "name": n} for d, n in sorted(j.items()) if d >= today][:5],
                    "map": {d: n for d, n in j.items() if lo <= d <= hi}})
                time.sleep(86400)
            except Exception:
                time.sleep(1800)

    def fx_loop(self):
        """Exchange rate (Frankfurter, ECB reference rates), hourly. `prev` = the last different
        value, persisted across restarts."""
        c = self.cfg["fx"]
        base, quote = c["base"].upper(), c["quote"].upper()
        cache = os.path.join(CACHE_DIR, "fx.json")
        cur = _load_json(cache)
        if not (isinstance(cur, dict) and cur.get("base") == base and cur.get("quote") == quote):
            cur = None
        if cur:
            self.set_extra("fx", cur)
        while True:
            try:
                j = self._get_json(f"https://api.frankfurter.app/latest?from={base}&to={quote}")
                rate, old = float(j["rates"][quote]), cur or {}
                prev = old.get("rate") if old.get("rate") not in (None, rate) else old.get("prev")
                cur = {"rate": rate, "prev": prev, "date": j.get("date"), "at": time.time(), "base": base, "quote": quote}
                self.set_extra("fx", cur)
                _save_json(cache, cur)
            except Exception:
                pass
            time.sleep(3600)

    def news_loop(self):
        """Headlines from an RSS 2.0 (or Atom) feed, every 15 min."""
        c = self.cfg["news"]
        atom = "{http://www.w3.org/2005/Atom}"
        while True:
            try:
                root = ET.fromstring(self.http_get(c["url"], limit=3_000_000))
                items = []
                for it in root.iter("item"):
                    t = (it.findtext("title") or "").strip()
                    if not t:
                        continue
                    try:
                        ts = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "").timestamp()
                    except Exception:
                        ts = None
                    items.append({"title": t, "at": ts})
                if not items:
                    for it in root.iter(atom + "entry"):
                        t = (it.findtext(atom + "title") or "").strip()
                        if not t:
                            continue
                        try:
                            ts = dt.datetime.fromisoformat((it.findtext(atom + "updated") or "").replace("Z", "+00:00")).timestamp()
                        except ValueError:
                            ts = None
                        items.append({"title": t, "at": ts})
                if items:
                    self.set_extra("news", {"items": items[: c["max_items"]], "at": time.time()})
            except Exception:
                pass
            time.sleep(900)

    def onthisday_loop(self):
        """On this day. lang ja: the ja.wikipedia day article (できごと + 日本の記念日), because the
        Wikimedia feed does not support ja. Other languages: the Wikimedia onthisday feed."""
        lang = self.cfg["onthisday"]["lang"]
        done = None
        while True:
            day = time.strftime("%Y-%m-%d")
            if day != done:
                try:
                    v = self._onthisday_ja(day) if lang == "ja" else self._onthisday_feed(day, lang)
                    if v and (v["events"] or v["observances"]):
                        self.set_extra("onthisday", v)
                        done = day
                except Exception:
                    pass
            time.sleep(600)

    def _onthisday_ja(self, day):
        lt = time.localtime()
        q = urllib.parse.urlencode({"action": "parse", "page": f"{lt.tm_mon}月{lt.tm_mday}日", "prop": "wikitext",
                                    "format": "json", "formatversion": 2})
        wt = self._get_json("https://ja.wikipedia.org/w/api.php?" + q)["parse"]["wikitext"]

        def sec(name):
            m = re.search(r"^==\s*" + name + r"[^=]*==\s*$(.*?)(?=^==[^=])", wt, re.M | re.S)
            return m.group(1) if m else ""
        events = []
        for line in sec("できごと").splitlines():
            m = re.match(r"^\*\s*(?:\[\[)?(\d{1,4})年(?:\]\])?[^-–]*?[-–]\s*(.+)$", line)
            if m:
                text = _wiki_plain(m.group(2))
                if len(text) >= 6:
                    events.append({"year": int(m.group(1)), "text": text})
        obs = []
        for line in sec("記念日").splitlines():
            if line.startswith("*") and not line.startswith("*:") and "JPN" in line:
                n = _wiki_plain(line.lstrip("* ").split("（")[0])
                if n:
                    obs.append(n)
        return {"date": day, "events": events, "observances": obs[:6]}

    def _onthisday_feed(self, day, lang):
        lt = time.localtime()
        j = self._get_json(f"https://api.wikimedia.org/feed/v1/wikipedia/{lang}/onthisday/all/{lt.tm_mon:02d}/{lt.tm_mday:02d}",
                           timeout=15)
        events = [{"year": int(e["year"]), "text": " ".join(str(e.get("text", "")).split())}
                  for e in (j.get("events") or []) if isinstance(e.get("year"), int) and e.get("text")]
        events.sort(key=lambda e: e["year"])
        obs = [" ".join(str(h.get("text", "")).split()) for h in (j.get("holidays") or []) if h.get("text")]
        return {"date": day, "events": events, "observances": obs[:6]}

    def launches_loop(self):
        """Upcoming launches (The Space Devs LL2, free tier ~15 req/h), every 3 h; cached so
        restarts do not refetch."""
        cache = os.path.join(CACHE_DIR, "launches.json")
        cur = _load_json(cache)
        wait = 0
        if isinstance(cur, dict) and cur.get("at"):
            self.set_extra("launches", cur)
            wait = max(0, 3 * 3600 - (time.time() - cur["at"]))
        time.sleep(wait)
        while True:
            ok = False
            try:
                j = self._get_json("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5&mode=list", timeout=20)
                out = [{"name": x.get("name") or "", "net": x.get("net"), "status": (x.get("status") or {}).get("abbrev") or "",
                        "provider": x.get("lsp_name") or "", "location": x.get("location") or ""} for x in j.get("results", [])]
                if out:
                    cur = {"items": out, "at": time.time()}
                    self.set_extra("launches", cur)
                    _save_json(cache, cur)
                    ok = True
            except Exception:
                pass
            time.sleep(3 * 3600 if ok else 1800)

    def kp_loop(self):
        """NOAA SWPC planetary Kp (3-hourly values), hourly: the last 24 values (3 days)."""
        while True:
            try:
                rows = []
                for r in self._get_json("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", timeout=15):
                    if isinstance(r, dict):
                        rows.append([r.get("time_tag"), float(r.get("Kp"))])
                    elif isinstance(r, list) and len(r) > 1 and r[0] != "time_tag":
                        rows.append([r[0], float(r[1])])
                if rows:
                    self.set_extra("kp", {"rows": rows[-24:], "at": time.time()})
            except Exception:
                pass
            time.sleep(3600)

    # ------------------------------------------------------------------ local: bluetooth / sessions / recent
    def bluetooth_loop(self):
        """Connected Bluetooth devices with battery % (system_profiler), every 5 min."""
        keys = (("device_batteryLevelMain", "main"), ("device_batteryLevel", "main"), ("device_batteryLevelLeft", "L"),
                ("device_batteryLevelRight", "R"), ("device_batteryLevelCase", "case"))
        while True:
            try:
                j = json.loads(self.sh(["/usr/sbin/system_profiler", "SPBluetoothDataType", "-json"], timeout=40) or "{}")
                out, paired = [], []
                for ctl in j.get("SPBluetoothDataType", []):
                    for d in ctl.get("device_not_connected", []) or []:   # paired but not connected: names only
                        for name, info in d.items():
                            paired.append({"name": name, "type": info.get("device_minorType") or ""})
                    for d in ctl.get("device_connected", []) or []:
                        for name, info in d.items():
                            bat = {}
                            for k, lab in keys:
                                m = re.match(r"(\d+)", str(info.get(k, "")))
                                if m:
                                    bat[lab] = int(m.group(1))
                            out.append({"name": name, "type": info.get("device_minorType") or "", "battery": bat})
                self.set_extra("bluetooth", {"devices": out, "paired": paired, "at": time.time()})
            except Exception:
                pass
            time.sleep(300)

    def _cloud_folders(self):
        c = self.cfg["cloud"]
        if c["folders"]:
            return [(f["name"], os.path.expanduser(f["path"])) for f in c["folders"]]
        root = os.path.expanduser("~/Library/CloudStorage")
        try:
            names = sorted(n for n in os.listdir(root) if not n.startswith(".") and os.path.isdir(os.path.join(root, n)))
        except OSError:
            return []
        return [(n, os.path.join(root, n)) for n in names]

    @staticmethod
    def _cloud_usage(path, deadline):
        """Bytes really stored on this Mac (allocated blocks: online-only placeholders count 0) and the number of
        downloaded files, by walking with lstat (never triggers a download). Stops at the deadline."""
        used = files = total = 0
        partial = False
        for dirpath, dirnames, filenames in os.walk(path):
            if time.time() > deadline:
                partial = True
                break
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for n in filenames:
                try:
                    st = os.lstat(os.path.join(dirpath, n))
                except OSError:
                    continue
                total += 1
                if st.st_blocks > 0:
                    files += 1
                    used += st.st_blocks * 512
        return {"used": used, "files": files, "total_files": total, "partial": partial}

    def cloud_loop(self):
        """Local usage of cloud-synced folders, every interval_minutes (a full walk is heavy: keep it rare)."""
        c = self.cfg["cloud"]
        while True:
            out = []
            for name, path in self._cloud_folders():
                if not os.path.isdir(path):
                    continue
                u = self._cloud_usage(path, time.time() + 120)
                label = name.replace("-", " · ", 1) if name.startswith(("OneDrive-", "GoogleDrive-", "Dropbox-", "Box-")) else name
                out.append(dict(u, name=label))
            free = None
            try:
                st = os.statvfs("/")
                free = st.f_bavail * st.f_frsize
            except OSError:
                pass
            self.set_extra("cloud", {"folders": out, "warn_bytes": int(c["warn_gb"] * 2 ** 30), "disk_free": free, "at": time.time()})
            time.sleep(c["interval_minutes"] * 60)

    # ------------------------------------------------------------------ USB-C power input
    # Fault counters of the USB-C port controller that should never move during normal charging.
    PORT_FAULTS = {"PortControllerHardResetCount": "ハードリセット", "PortControllerShortDetectCount": "短絡検出",
                   "PortControllerInpFetEnFailCount": "入力スイッチ失敗", "PortControllerHvEnRecoveryCount": "高電圧の復旧",
                   "PortControllerCapMismatch": "電力の不一致", "PortControllerSrdoRejectCount": "電力要求の拒否"}

    def _read_power(self):
        import plistlib
        try:
            raw = subprocess.run(["/usr/sbin/ioreg", "-rw0", "-c", "AppleSmartBattery", "-a"], capture_output=True, timeout=5).stdout
            j = (plistlib.loads(raw) or [{}])[0] if raw else {}
        except Exception:
            return None
        ad = j.get("AdapterDetails") or {}
        pt = j.get("PowerTelemetryData") or {}
        cd = j.get("ChargerData") or {}
        pc = (j.get("PortControllerInfo") or [{}])[0]
        offers = [{"v": m.get("MaxVoltage", 0) / 1000, "a": m.get("MaxCurrent", 0) / 1000} for m in ad.get("UsbHvcMenu") or []]
        return {
            "connected": bool(j.get("ExternalConnected")), "charging": bool(j.get("IsCharging")), "full": bool(j.get("FullyCharged")),
            "percent": j.get("CurrentCapacity"),
            "adapter": {"name": ad.get("Name") or "", "manufacturer": ad.get("Manufacturer") or "", "description": ad.get("Description") or "",
                        "watts": ad.get("Watts"), "volts": (ad.get("AdapterVoltage") or 0) / 1000 or None,
                        "amps": (ad.get("Current") or 0) / 1000 or None, "wireless": bool(ad.get("IsWireless")),
                        "offers": offers, "active": ad.get("UsbHvcHvcIndex")} if ad else None,
            "input": {"watts": (pt.get("SystemPowerIn") or 0) / 1000, "volts": (pt.get("SystemVoltageIn") or 0) / 1000,
                      "amps": (pt.get("SystemCurrentIn") or 0) / 1000, "loss_watts": (pt.get("AdapterEfficiencyLoss") or 0) / 1000,
                      "system_watts": (pt.get("SystemLoad") or 0) / 1000} if pt else None,
            "battery": {"volts": (j.get("Voltage") or 0) / 1000, "amps": (j.get("Amperage") or 0) / 1000,
                        "watts": (pt.get("BatteryPower") or 0) / 1000, "cycles": j.get("CycleCount")},
            "charger": {"not_charging_reason": cd.get("NotChargingReason", 0), "slow_reason": cd.get("SlowChargingReason", 0),
                        "thermal_limited_s": cd.get("TimeChargingThermallyLimited", 0)},
            "faults": {k: pc.get(k, 0) for k in self.PORT_FAULTS},
        }

    def power_loop(self):
        """USB-C input every interval_seconds: what was negotiated, what flows, and warning signs (counters that
        moved since the server started, input voltage off the contract, power above the adapter's rating)."""
        c = self.cfg["power"]
        base, hist, last_vals, changed_at = None, [], None, time.time()
        while True:
            p = self._read_power()
            if p:
                alerts = []
                if base is None:
                    base = dict(p["faults"])
                for k, label in self.PORT_FAULTS.items():
                    d = (p["faults"].get(k) or 0) - (base.get(k) or 0)
                    if d > 0:
                        alerts.append({"level": "danger" if k in ("PortControllerShortDetectCount", "PortControllerInpFetEnFailCount",
                                                                 "PortControllerHvEnRecoveryCount") else "warn",
                                       "text": f"USB-C ポート: {label} が {d} 回"})
                ad, inp = p["adapter"], p["input"]
                if p["connected"] and ad and inp and ad.get("volts") and inp["amps"] > .2:
                    dev = abs(inp["volts"] - ad["volts"]) / ad["volts"] * 100
                    if dev > c["voltage_tolerance_pct"]:
                        alerts.append({"level": "danger" if dev > 2 * c["voltage_tolerance_pct"] else "warn",
                                       "text": f"入力電圧 {inp['volts']:.2f}V（契約 {ad['volts']:.0f}V から {dev:.0f}% ずれ）"})
                if p["connected"] and ad and inp and ad.get("watts") and inp["watts"] > ad["watts"] * 1.08:
                    alerts.append({"level": "warn", "text": f"入力 {inp['watts']:.1f}W が定格 {ad['watts']}W を超えています"})
                if p["connected"] and ad and ad.get("description") and "pd" not in ad["description"].lower():
                    alerts.append({"level": "info", "text": f"USB PD ではない充電（{ad['description']}）"})
                # the battery controller refreshes its telemetry only every minute or so (rarely when full):
                # record a sample only when the values change, and say how old they are
                vals = (inp or {}).get("watts"), (inp or {}).get("volts"), (inp or {}).get("amps")
                if vals != last_vals:
                    last_vals, changed_at = vals, time.time()
                    hist = (hist + [round(inp["watts"], 2) if inp else 0])[-120:]
                p.update(alerts=alerts, history=hist, at=time.time(), measured_at=changed_at)
                self.set_extra("power", p)
            time.sleep(c["interval_seconds"])

    def sessions_loop(self):
        """Local Claude Code sessions (live pids in ~/.claude/sessions); only the cwd basename leaves."""
        while True:
            live = []
            for f in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
                try:
                    with open(f, "rb") as fh:
                        j = json.loads(fh.read(256_000))
                    os.kill(int(j["pid"]), 0)
                    live.append({"cwd": os.path.basename(str(j.get("cwd", "")).rstrip("/")), "kind": j.get("kind")})
                except Exception:
                    continue
            self.set_extra("sessions", {"local": live})
            time.sleep(15)

    def _recent_cache(self):
        return os.path.join(CACHE_DIR, "recent.json")

    def record_recent(self, p):
        """Called by player_loop on each track change: last N distinct tracks, persisted."""
        if not self.cfg["recent"]["enabled"] or not p.get("title"):
            return
        with self.lock:
            rec = list((self.extra.get("recent") or {}).get("items") or [])
            if rec and rec[0].get("title") == p["title"] and rec[0].get("artist") == p["artist"]:
                return
            rec = ([{"title": p["title"], "artist": p["artist"], "source": p["source"], "at": time.time()}] + rec)
            rec = rec[: self.cfg["recent"]["max_items"]]
            self.extra["recent"] = {"items": rec}
        _save_json(self._recent_cache(), rec)

    # ------------------------------------------------------------------ GitHub via gh (personal, opt-in)
    def _gh(self):
        g = self.cfg["github"]["gh_path"]
        if "/" in g:
            return os.path.expanduser(g)
        path = os.pathsep.join([os.environ.get("PATH", "")] + list(GH_FALLBACK_DIRS))
        return shutil.which(g, path=path) or g

    def _gh_graphql(self, q):
        return json.loads(self.sh([self._gh(), "api", "graphql", "-f", f"query={q}"], timeout=30) or "{}")

    def contrib_loop(self):
        """Daily contribution counts for the last 14 weeks (gh api graphql, hourly)."""
        q = ("query { viewer { contributionsCollection { contributionCalendar { totalContributions "
             "weeks { contributionDays { date contributionCount } } } } } }")
        while True:
            try:
                cal = self._gh_graphql(q)["data"]["viewer"]["contributionsCollection"]["contributionCalendar"]
                days = [[d["date"], d["contributionCount"]] for w in cal["weeks"] for d in w["contributionDays"]]
                self.set_extra("contrib", {"days": days[-7 * 14:], "year": cal["totalContributions"], "at": time.time()})
            except Exception:
                pass
            time.sleep(3600)

    def github_loop(self):
        """Review requests + my open PRs with CI state (gh GraphQL, every 10 min)."""
        q = """query { viewer { login }
          rr: search(query: "is:open is:pr review-requested:@me archived:false", type: ISSUE, first: 10) { issueCount nodes { ... on PullRequest { title url repository { name } } } }
          mine: search(query: "is:open is:pr author:@me archived:false", type: ISSUE, first: 20) { issueCount nodes { ... on PullRequest { title url repository { name }
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }"""
        while True:
            try:
                d = self._gh_graphql(q).get("data") or {}
                if d:
                    mine = []
                    for n in (d.get("mine") or {}).get("nodes", []):
                        try:
                            st = n["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"]
                        except (KeyError, IndexError, TypeError):
                            st = None
                        mine.append({"title": n.get("title"), "repo": (n.get("repository") or {}).get("name"), "ci": st})
                    rr = d.get("rr") or {}
                    self.set_extra("github", {
                        "review": rr.get("issueCount", 0),
                        "review_items": [{"title": n.get("title"), "repo": (n.get("repository") or {}).get("name")}
                                         for n in rr.get("nodes", [])],
                        "mine": mine, "failing": sum(1 for x in mine if x["ci"] in ("FAILURE", "ERROR")), "at": time.time()})
            except Exception:
                pass
            time.sleep(600)

    def rfc_loop(self):
        """Documents awaiting approval in a GitHub repo (every 10 min): reads the newest 25 files in
        `dir` whose names start with `file_prefix`, finds the markdown table row `| <status_label> | … |`
        and reports those whose value contains `pending_text`."""
        c = self.cfg["rfc"]
        gh, repo, d, prefix = self._gh(), c["repo"], c["dir"].strip("/"), c["file_prefix"]
        label = re.escape(c["status_label"])
        id_re = re.compile(re.escape(prefix) + r"\d{8}-(\d+)")
        while True:
            try:
                names = json.loads(self.sh([gh, "api", f"repos/{repo}/contents/{d}", "--jq", "[.[].name]"], timeout=30) or "[]")
                names = [n for n in names if isinstance(n, str) and n.startswith(prefix) and n.endswith(".md")]
                pending = []
                for n in sorted(names)[-25:]:
                    raw = self.sh([gh, "api", f"repos/{repo}/contents/{d}/{n}", "--jq", ".content"], timeout=30)
                    try:
                        txt = base64.b64decode(raw).decode("utf-8", "replace")
                    except Exception:
                        continue
                    m = re.search(r"^\|\s*" + label + r"\s*\|\s*([^|]+)\|", txt, re.M)
                    if m and c["pending_text"] in m.group(1):
                        num = id_re.search(n)
                        pending.append({"id": num.group(1) if num else n[:-3], "name": n[:-3],
                                        "user_action": bool(c["user_action_text"]) and c["user_action_text"] in m.group(1)})
                if names:
                    self.set_extra("rfc", {"pending": pending, "at": time.time()})
            except Exception:
                pass
            time.sleep(600)
