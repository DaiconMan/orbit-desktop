# System Stats HUD

Status line plus sparklines for CPU, memory, disk I/O and network, one latency row per configured
ping target, and the last `networkQuality` speed test.

- **needs:** `system`
- **settings:** `show_status`, `show_disk`, `show_network`, `show_ping`, `show_speed`, `speed_full_scale_mbps`
- **providers:** `providers.ping.targets` (none by default), `providers.speedtest.enabled` (off by default)

```yaml
providers:
  ping:
    targets:
      - { name: NAS, host: 192.168.1.10, method: tcp, port: 22 }
      - { name: ROUTER, host: 192.168.1.1 }
```
