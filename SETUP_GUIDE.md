# Hospital Admin Backend – ngrok & ABDM Bridge Setup Guide

This guide covers how to expose your local backend to the ABDM sandbox using **ngrok** and how the **automatic bridge URL configuration** works.

---

## ngrok Setup

### Why ngrok?

ABDM sandbox needs a **publicly accessible HTTPS URL** to send callbacks (discovery requests, consent notifications, data push, patient share, etc.) to your server. When running locally, your `localhost:4000` isn't reachable from the internet — ngrok solves this by creating a secure tunnel.

### Install ngrok

**macOS:**
```bash
brew install ngrok
```

**Windows:**
```powershell
# Option 1: Using Chocolatey
choco install ngrok

# Option 2: Using Winget
winget install ngrok

# Option 3: Manual download
# Download from https://ngrok.com/download → extract the zip → add ngrok.exe to your PATH
```

**Or download directly:** [https://ngrok.com/download](https://ngrok.com/download)

After installing, authenticate with your ngrok account (free tier works):

```bash
ngrok config add-authtoken <YOUR_NGROK_AUTH_TOKEN>
```

> Get your auth token from [https://dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)

### Running ngrok

Open **two terminals**:

**Terminal 1 – Start the backend:**
```bash
npm run dev
```

**Terminal 2 – Start ngrok tunnel:**
```bash
ngrok http 4000
```

ngrok will output something like:

```
Session Status   online
Forwarding       https://a1b2-103-255-145-15.ngrok-free.app -> http://localhost:4000
```

### Update `.env` with ngrok URL

Copy the `https://xxxx.ngrok-free.app` URL and set it in your `.env`:

```env
ABDM_CALLBACK_URL=https://a1b2-103-255-145-15.ngrok-free.app
```

Then **restart the server** (`Ctrl+C` → `npm run dev`).

---

## Automatic Bridge URL Registration

### The Problem

Previously, every time ngrok restarted (and generated a new URL), you had to:
1. Copy the new ngrok URL
2. Update `.env`
3. Manually call the ABDM bridge URL update API or use the sandbox portal

### The Solution

Now the server **automatically registers the bridge URL with ABDM on every startup**.

### How It Works

When the server starts listening, `setBridgeUrlOnStartup()` in `src/services/startup.service.ts` runs automatically:

1. **Authenticate** → `POST /hiecm/gateway/v3/sessions` using `ABDM_CLIENT_ID` + `ABDM_CLIENT_SECRET`
2. **Set Bridge URL** → `PATCH /hiecm/gateway/v3/bridge/url` with the `ABDM_CALLBACK_URL` value

### What You'll See in the Console

**On success:**
```
[STARTUP] Starting ABDM Bridge URL Configuration -> https://a1b2-103-255-145-15.ngrok-free.app
[STARTUP] Successfully set ABDM Bridge URL.
```

**If `ABDM_CALLBACK_URL` is not set:**
```
[STARTUP] ABDM_CALLBACK_URL is not set. Skipping bridge URL setup.
```

**If credentials are wrong or ABDM is unreachable:**
```
[STARTUP] Error configuring ABDM Bridge URL: <error details>
```
> The server will still start normally — bridge URL setup failure does not crash the server.

### Workflow After ngrok Restart

```
1. ngrok restarts → new URL generated
2. Copy new URL → update ABDM_CALLBACK_URL in .env
3. Restart server (npm run dev)
4. Bridge URL auto-registered with ABDM ✓
5. All ABDM callbacks now route to your local server ✓
```

---

## Required `.env` Variables for ABDM

| Variable | Description |
|---|---|
| `ABDM_BASE_URL` | ABDM API base (`https://dev.abdm.gov.in/api` for sandbox) |
| `ABDM_CLIENT_ID` | Your bridge client ID |
| `ABDM_CLIENT_SECRET` | Your bridge client secret |
| `ABDM_CALLBACK_URL` | **Your ngrok URL** (updated each time ngrok restarts) |
| `ABDM_FACILITY_ID` | Facility ID registered with ABDM |
| `ABDM_BRIDGE_ID` | Bridge ID (usually same as client ID) |
| `ABDM_X_HIP_ID` | HIP ID for request headers |
| `ABDM_X_HIU_ID` | HIU ID for request headers |
| `ABDM_X_CM_ID` | Consent Manager ID (`sbx` for sandbox) |
| `REGISTRATION_URL` | Facility registration URL |

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `[STARTUP] ABDM_CALLBACK_URL is not set` | Add `ABDM_CALLBACK_URL` to `.env` |
| `[STARTUP] Error configuring ABDM Bridge URL` | Verify `ABDM_CLIENT_ID`, `ABDM_CLIENT_SECRET`, and `ABDM_BASE_URL` |
| ngrok URL changed after restart | Update `ABDM_CALLBACK_URL` in `.env` and restart the server |
| ABDM callbacks not reaching server | Ensure ngrok is running and the URL in `.env` matches the active ngrok session |
| `ERR_NGROK_3200` (tunnel not found) | Your ngrok session expired — restart ngrok and update `.env` |

> **Tip:** Use `ngrok http 4000 --domain=your-static.ngrok-free.app` with a [free static domain](https://dashboard.ngrok.com/domains) to avoid updating the URL on every restart.
