# Alerts (緊急地震速報 / 津波)

A full-width banner for Japan's Earthquake Early Warning (緊急地震速報: serial, epicentre, magnitude,
depth, predicted maximum intensity, a seconds-since-origin counter and the areas to brace for strong
shaking; 取消 when cancelled) and for tsunami warnings (大津波警報 / 津波警報 / 津波注意報 with the coastal
areas, heights and 直ちに来襲). A red glow flashes along the banner's edges once per new event. When
nothing is active the widget is hidden and takes no space.

Place it at the top, full width, above everything, and exempt it from dimming (the runtime dims the
other widgets while an alert is active):

```yaml
- use: alerts
  position: { anchor: top-left, x: 0, y: 0, width: 100vw, z: 90 }
  dim: false
```

- **needs:** `alerts` (written by the host app from the P2PQuake WebSocket stream: `eew`, `tsunami`)
- **settings:** none
