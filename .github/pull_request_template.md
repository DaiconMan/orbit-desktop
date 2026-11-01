## What
<!-- One or two sentences. For a plugin: what it shows. -->

## Type
- [ ] New widget / background
- [ ] Plugin update
- [ ] Runtime / SDK
- [ ] Host / provider / dev server
- [ ] Docs / tooling

## Plugin checklist (skip if not a plugin)
- [ ] `python3 tools/validate.py` prints **OK**, and I fixed or explained every red-flag warning for my plugin
- [ ] `needs:` is minimal: <!-- list each signal and why -->
- [ ] README covers what it shows, needs, settings and data sources
- [ ] No network use, no obfuscated or minified code, untrusted strings escaped
- [ ] Bundled data/assets are licensed compatibly and credited (README + THIRD_PARTY_NOTICES.md)
- [ ] Tested with `?demo` and with real data, with no errors in the on-screen problems panel
- [ ] Screenshot attached (no personal data visible)

## Host / runtime checklist (skip if not applicable)
- [ ] Hardening intact (loopback bind, Host/Origin checks, explicit file allow-list, GET only)
- [ ] Any new outbound request is off by default or switchable, and listed in `docs/security.md`
- [ ] `docs/provider-api.md` updated; still implementable by the Swift host
- [ ] No personal data (IPs, host names, coordinates) in code or examples

## Screenshots
