# Home Net

HOME / AWAY in the header, Tailscale state and IP, the NAS shares and whether each is mounted, a
latency sparkline per ping target (OFFLINE in red when unreachable), and the last `networkQuality`
speed test. LAN rows fade while you are away from home. Share names and ping targets are whatever the
host reports; nothing is hard-coded.

- **needs:** `network` (sensitive: home detection, Tailscale IP, share names, LAN hosts)
- **settings:** `speed_full_scale_mbps` (1000): speed bars are full at this rate

**Mount / unmount:** click a NAS share. The host app unmounts a mounted share (`diskutil unmount`), or mounts it again through Finder with the URL it remembered while the share was mounted, using your Keychain password. Shares never seen mounted can't be mounted from here.
