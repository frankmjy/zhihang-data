# Intranet Keepalive Migration

## Purpose

`scripts/intranet-keepalive.js` is the standalone keepalive script extracted from the current risk/change/drill local service. It opens a dedicated Chrome or Edge window, reuses the user's manual intranet login cookies, and periodically pings intranet pages to reduce idle session expiry.

The script does not store VPN usernames, passwords, OTPs, cookies, or tokens.

## Local Usage

```powershell
npm run local:keepalive
```

Or double-click:

```text
start-intranet-keepalive.bat
```

Connect VPN before first run, then complete intranet login in the Chrome or Edge window opened by the script. Keep the terminal open while the session should stay warm.

## Move To Another PC

1. Install Node.js 22 or newer.
2. Extract `dist\intranet-keepalive-standalone.zip`.
3. Copy `.env.keepalive.example` to `.env.keepalive` and edit intranet origins if needed.
4. Connect VPN.
5. Double-click `start-intranet-keepalive.bat`.
6. Complete intranet login in the opened browser window.

## Common Config

- `INTRANET_KEEPALIVE_ORIGINS`: comma-separated intranet origins.
- `INTRANET_KEEPALIVE_INTERVAL_MS`: healthy heartbeat interval, default 5 minutes.
- `INTRANET_KEEPALIVE_DEBUG_PORT`: browser DevTools port, default `9222`.
- `INTRANET_KEEPALIVE_PROFILE_DIR`: dedicated browser user data directory.
- `INTRANET_KEEPALIVE_BROWSER_PATH`: Chrome or Edge path, blank means auto-detect.

## Checks

```powershell
node intranet-keepalive.js --print-config
node intranet-keepalive.js --once
```

`--once` performs a real heartbeat, so connect VPN and finish intranet login first.
