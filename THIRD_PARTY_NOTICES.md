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

## Optional external services (no code or data redistributed)
* iTunes Search API (artwork fallback, opt-in)
* ipinfo.io (IP geolocation, opt-in)
* CoreLocationCLI (optional local tool, MIT, installed separately via Homebrew)

These are subject to their own terms.

## Trademarks
Apple Music, Spotify, Claude and Anthropic are trademarks of their respective owners. The
`claude-usage` plugin is unofficial and is not affiliated with or endorsed by Anthropic.
