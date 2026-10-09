# Graph+ theme colors

Graph+ follows Obsidian's active graph colors for default and community themes, in light and dark mode. Native `.graph-view.color-*` rules take precedence over graph CSS variables and generic theme fallbacks. Graph+ does not substitute a special palette for Obsidian's default theme.

The graph surface uses `--graph-background` when supplied, otherwise `--background-primary`. Memory defaults to the theme's focused-node color; `--graph-plus-memory-constellation` can override it. Explicit Graph+ background/note/tag color settings and the opt-in Frank mode remain available.

Computed CSS can preserve OKLCH, OKLab, `color-mix()`, and other browser-supported formats. When the engine's basic hex/RGB/HSL parser cannot read a color, the Obsidian adapter lets a one-pixel sRGB canvas convert it. This happens during theme resolution, not the rendering loop. Native role opacity must multiply the color alpha without treating non-RGB coordinates as RGB channels.

## October 8, 2026 investigation

The local Obsidian log records an update from 1.13.7 to 1.14.4. Comparing their retained application packages showed unchanged native graph role selectors, graph color variables, and accent values. Obsidian 1.14 adds highlight and other UI styling, but did not change these graph color definitions.

The installed Ebullientworks CSS (2.0.2, modified October 8) differs from the vault's committed 1.0.1 snapshot: its palette uses OKLCH instead of hex and adjusts the colors. Previously Graph+ tried to parse the browser's computed OKLCH value as hex/RGB/HSL twice, then silently used the engine fallback palette.

An isolated Chromium check combined both Obsidian CSS versions with both theme snapshots and both appearance modes. Results were identical between Obsidian versions. The updated theme reproduced the blue fallback with the previous resolver and correctly resolved its own colors with the fixed resolver.

| Role | Saved theme 1.0.1 | Installed theme 2.0.2 (sRGB) |
| --- | --- | --- |
| Dark note node | `#8e6787` | `#8c6585` |
| Light note node | `#c6b2c3` | `#c7a1c0` |
| Tag node | `#91a695` | `#759a7c` |
| Focused node | `#ecc986` | `#f0d7a6` |

The old Graph+ resolver incorrectly used `#7aa2f7` for note nodes with the installed theme. Automated tests cover native role precedence and opacity, OKLCH conversion, light/dark theme changes, surface background fallback, and explicit overrides. Verification in a reloaded Obsidian graph is a separate acceptance check.
