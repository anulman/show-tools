# Confirmed peripheral inventory

Source: the operator's [PR #3 inventory comment](https://github.com/anulman/show-tools/pull/3#discussion_r4385787375) and [arrival confirmation](https://github.com/anulman/show-tools/pull/3#discussion_r4385950356). All listed components have arrived; the plan can cover the complete harness.

| Quantity | Component | Operator-supplied reference |
| --- | --- | --- |
| 4 | 100 mm illuminated arcade buttons with LEDs | [Adafruit #1185](https://www.adafruit.com/product/1185), representative colour from the same button family |
| 1 | Momentary foot pedal with 2 m cable | [Adafruit #423](https://www.adafruit.com/product/423) |
| 1 | Red momentary mushroom button, NO/NC contacts; use NO | [Addison NPB22-M611R](https://addison-electronique.com/en/momentary-push-button-switch-mushroom-head-n-o-n-c-red.html) |
| 1 | SpinTrak rotary encoder, direct I-PAC connection, no separate USB interface | [Ultimarc SpinTrak](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/) |
| 1 | I-PAC Ultimate I/O input/LED controller, 4.8 mm harness variant | [Ultimarc I-PAC Ultimate I/O](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) |

The I-PAC is the controller board in this parts plan. Do not introduce an additional Arduino or choose a different controller without asking the operator.

## Confirmed intended behavior

- The operator expects controller inputs to appear as keyboard events, with direction and distance updates for the knob. Verify the actual SpinTrak/controller configuration and host reports before choosing an adapter. Intended behavior is not a measured USB report format.
- The foot pedal controls BPM through beat taps. For 6/8, the operator confirmed chart and pedal counting as `1 2 3 4 5 6` in eighth-note beats. Tapping can begin on any beat; the first tap does not identify a downbeat or reset transport position. Device key mapping and unprovided tempo-estimation details still need confirmation.
- Other control purposes vary by song. The knob is not globally assigned to gain. Button labels may become colours such as Red, Blue, Yellow and Green; identifiers should remain consistent across songs without encoding voice identity or a fixed action.
- Lights are the LEDs built into the arcade buttons. Browser pads should follow the same semantic lit, pulse, blink and trigger behavior.
- Pending actions and recording need distinct pulse/blink patterns. Which state uses which pattern is not yet confirmed. Single-use triggers need a rapid attack, brief hold and decay; no numeric envelope has been selected.
- Output follows the corresponding peripheral's cadence. Consumers handle smoothing appropriate to physical LEDs or browser pads. Do not invent a fixed update rate or PWM capability.

These requirements come from the operator's [PR #3 review](https://github.com/anulman/show-tools/pull/3). They supersede the plan's fixed gain-knob assignment and arbitrary output-cadence proposal.

## Facts still requiring confirmation

Consult manufacturer documentation for product capabilities. Ask the operator about the actual installation, controller configuration, operating system, chosen key mappings, firmware/settings, and available electrical connections wherever these affect the proposed integration. Obtain the facts before specifying the dependent protocol, wiring or driver design. Do not fill gaps with plausible defaults.

A simulator may model explicitly declared inputs and outputs, but its success does not verify physical reports, LED control or wiring. Identify unsupported assumptions and blocked steps in the plan rather than presenting them as implemented capabilities.
