# Third-party notices

Orbit Desktop is MIT-licensed (see `LICENSE`). It includes or uses the following third-party
material.

## Star catalogue: d3-celestial data (BSD-3-Clause)
`widgets/starfield/data/stars.6.json` comes from
[d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn. It is derived from the
Yale Bright Star Catalogue (5th rev., Hoffleit & Warren, distributed by NASA/ADC / CDS).

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions
   and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of
   conditions and the following disclaimer in the documentation and/or other materials provided
   with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be used to
   endorse or promote products derived from this software without specific prior written
   permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
A copy also ships as `widgets/starfield/data/LICENSE`.

## Weather data: Open-Meteo (CC BY 4.0)
Forecasts come at runtime from the [Open-Meteo](https://open-meteo.com/) API. Open-Meteo data is
licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Attribution: **"Weather data by Open-Meteo.com"**. The weather widget displays this credit by
default (`show_attribution`). Open-Meteo's free API is for non-commercial use. Commercial users
need an Open-Meteo API plan.

## Algorithms (credited, no code copied)
* Planet and Moon positions: Paul Schlyter, *How to compute planetary positions*
  (simplified orbital elements).
* Galactic → equatorial rotation matrix: standard IAU J2000 values.

## Not vendored
No JavaScript libraries are vendored. YAML is parsed on the host by the project's own
`host/dev-server/miniyaml.py`, so js-yaml is **not** included.

Air quality (`providers.weather.air`) comes from the Open-Meteo Air Quality API (CAMS data, same
CC BY 4.0 licence and attribution). Surface pressure uses the same forecast API.

## Optional external services (no code or data redistributed)
All of these are off by default and fetched only by the local host, never by widgets.

| service | provider | terms / licence |
|---|---|---|
| iTunes Search API | `now_playing.itunes_artwork_fallback` | Apple Media Services terms |
| ipinfo.io | `location.mode: ip` | ipinfo.io terms (free tier) |
| Where the ISS at? (`api.wheretheiss.at`) | `iss` | free public API, rate-limited (~1 req/s) |
| P2P地震情報 (`api.p2pquake.net`), JMA earthquake reports | `quakes` | P2PQuake API terms; source data: Japan Meteorological Agency |
| holidays-jp (`holidays-jp.github.io`) | `holidays` | MIT; data from the Cabinet Office of Japan |
| Frankfurter (`api.frankfurter.app`) | `fx` | free, open source (MIT); ECB euro foreign exchange reference rates |
| NHK News RSS (`www.nhk.or.jp/rss`) or the feed you configure | `news` | headlines only, shown for personal use; NHK's terms of use apply (no redistribution) |
| Wikipedia (`ja.wikipedia.org` API, Wikimedia `api.wikimedia.org` feed) | `onthisday` | text CC BY-SA 4.0; Wikimedia API terms (User-Agent sent) |
| The Space Devs Launch Library 2 (`ll.thespacedevs.com`) | `launches` | free tier (~15 req/h); results cached 3 h |
| NOAA SWPC (`services.swpc.noaa.gov`) | `kp` | US government work, public domain |
| GitHub API via the `gh` CLI | `github`, `contrib`, `rfc` | GitHub Terms of Service; uses your own `gh` login |
| CoreLocationCLI | `location.mode: corelocation` | MIT, optional local tool installed separately via Homebrew |

These are subject to their own terms.

## Trademarks
Apple Music, Spotify, Claude and Anthropic are trademarks of their respective owners. The
`claude-usage` plugin is unofficial and is not affiliated with or endorsed by Anthropic.
