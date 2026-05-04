# CStanding — M+ Community Standing

A World of Warcraft addon that shows your Mythic+ percentile rank in the community. Displays a small draggable frame with your standing (e.g. **Standing: Top 1%**) and supports a `/cstanding` slash command to refresh it.

Built for **WoW Midnight Season 1**, retail client.

---

## How it works

- The in-game frame reads your M+ score via the **RaiderIO addon** (`RaiderIO.GetProfile("player")`).
- Percentile cutoffs are computed **offline** from RaiderIO's own binary character database (642K+ US characters) using the included `compute_percentiles.js` script.
- Running the script re-computes exact cutoffs from the latest RaiderIO data and patches them directly into `CStanding.lua` — no manual editing needed.

---

## Requirements

- World of Warcraft **retail** client
- [Raider.IO addon](https://www.curseforge.com/wow/addons/raider-io) installed and enabled, including at least one regional **database addon** (e.g. `RaiderIO_DB_US_M` for US Mythic+)
- [Node.js](https://nodejs.org/) v18+ — only needed to run the percentile updater script

---

## Installation

1. Copy the `CStanding` folder into your WoW AddOns directory:
   ```
   World of Warcraft\_retail_\Interface\AddOns\CStanding\
   ```
2. Enable **CStanding** on the character select screen (AddOns button, bottom-left).
3. Log in — the frame appears after ~3 seconds.

---

## Updating percentile cutoffs

RaiderIO updates its character database multiple times per day. Run the updater script whenever you want fresh cutoffs.

### Step 1 — Set your paths in `compute_percentiles.js`

Open `compute_percentiles.js` and update the two path constants near the top to match your system:

```js
const WOW_ADDONS = 'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Interface\\AddOns';
```

This is the only line you need to change. It controls where the script finds the RaiderIO database and where it writes back to `CStanding.lua`.

**Common alternative paths:**

| Scenario | Path |
|---|---|
| Default 64-bit install | `C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns` |
| WoW installed on a different drive | `D:\World of Warcraft\_retail_\Interface\AddOns` |
| Custom install location | Whatever you chose during installation |

> **Tip:** In Windows Explorer, navigate to your WoW folder → `_retail_` → `Interface` → `AddOns`. Copy that path from the address bar.

### Step 2 — Run the script

**Option A — run directly with Node.js:**
```bash
node compute_percentiles.js
```

**Option B — build a standalone `.exe` (no Node.js needed to run it later):**
```bash
npm install -g pkg
pkg compute_percentiles.js --targets node18-win-x64 --output UpdateStandings.exe
```
Then just double-click `UpdateStandings.exe` any time you want to update.

### Step 3 — Reload in-game

After the script finishes, type `/reload` in WoW (or relog) to apply the new cutoffs.

---

## Percentile tiers

| Standing | Score threshold (Midnight S1, US) |
|---|---|
| Top 0.1% | 3787 |
| Top 0.5% | 3644 |
| Top 1%   | 3557 |
| Top 2.5% | 3432 |
| Top 5%   | 3318 |
| Top 10%  | 3156 |
| Below top 10% | — |

These are baked into `CStanding.lua` and updated by the script. They reflect the score distribution at the time the script was last run.

---

## In-game usage

| Action | Result |
|---|---|
| Log in | Frame appears, standing shown after ~3 sec |
| Drag the frame | Repositions freely; position saved between sessions |
| `/cstanding` | Refreshes the display and echoes standing to chat |

---

## Changing the region

The script currently reads the **US Mythic+** database (`db_mythicplus_us_lookup.lua`). To use a different region, change the filename in `compute_percentiles.js`:

```js
// US
'RaiderIO', 'db', 'db_mythicplus_us_lookup.lua'

// EU
'RaiderIO', 'db', 'db_mythicplus_eu_lookup.lua'

// KR
'RaiderIO', 'db', 'db_mythicplus_kr_lookup.lua'

// TW
'RaiderIO', 'db', 'db_mythicplus_tw_lookup.lua'
```

Make sure you have the matching regional database addon enabled in WoW (`RaiderIO_DB_EU_M`, etc.).

---

## Notes

- The score shown in-game comes from RaiderIO's snapshot (updated daily), not real-time. Your standing may lag by up to 24 hours after a session.
- Scores below 200 are not tracked by RaiderIO and will show **Standing: No Data**.
- The `.exe` is excluded from this repo (it's 36 MB and system-specific). Build it yourself with the `pkg` command above.
