# Power Input (USB-C)

What the charger offers, what was negotiated and what really flows in. The values come from the Mac's battery
controller (`ioreg -c AppleSmartBattery`); no extra permission is needed.

* the input watts, volts and amps, with a sparkline (scale: the adapter's rating)
* the adapter's name and maximum, and the USB PD offers (5V / 9V / 15V / 20V …) with the active contract
  highlighted
* the battery's charging or discharging power, and the adapter-side loss
* warning signs, which also turn the header red or orange:
  * a USB-C port fault counter moved since the server started (hard reset, short detect, input FET enable
    failure, HV recovery, capability mismatch, rejected power request)
  * the input voltage is off the contract by more than `providers.power.voltage_tolerance_pct` (default 8 %)
  * the input power is above the adapter's rating
  * the charger is not USB PD

The battery controller refreshes these values only every minute or so (less often when the battery is
full); the header says how old the measurement is (「n分前の測定」).

needs: `power` (enable `providers.power`). Settings: `show_offers`, `show_battery`.

**Limits:** this is monitoring, not protection. A surge that damages hardware happens in microseconds to
milliseconds, far faster than any polling. Use a trusted charger and cable, or a USB-C power meter with hardware
protection.
