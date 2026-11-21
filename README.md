# LeaveMate

LeaveMate checks a personal checklist when a departure event arrives. It compares monitored belongings with item detections, saves the session, and raises one alert listing every missing item. The five views are Overview, Item Management, Detection & Verification, Alerts & History, and Analytics & Reports.

## Run locally

Install Node.js 22.12 or later. Extract the source, open a terminal in the `LeaveMate` folder, and run:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. For the built version, run `npm run build` followed by `npm start`, then open **http://127.0.0.1:4100**. Local mode creates a persistent PostgreSQL database in `.leavemate/` using PGlite. The schema is shared with Supabase. Your first run starts with an empty checklist and history.

1. In **Item Management**, add a wallet, keys, or other belongings. Choose **Essential** or **Optional** and keep monitoring enabled. Detection identifiers can be added later.
2. Open **Detection & Verification**. In **Test / Simulation**, uncheck any belongings you want to simulate as missing and run a test departure. The comparison appears after the window closes.
3. Open the notification or **Alerts & History** to inspect the combined alert. Click **Acknowledge & stop** to stop future announcements for that alert. If the browser requires audio permission, click **Enable audio** or use **Settings → Voice alerts → Test voice**.
4. Open **Verification History** or **Analytics & Reports** to filter records and export a CSV.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `web/` | React, TypeScript, Vite, Tailwind, Lucide, Recharts, Socket.IO client, speech synthesis, and browser notification permissions |
| `server/` | Express API, verification orchestration, detection providers, alerts, real-time publishing, and database access |
| `shared/` | Request, result, and event types and image mapping |
| `database/` | Relational PostgreSQL schema |
| `tests/` | API, persistence, gateway, and browser workflow checks |

An event enters the verification engine through the simulation route or the generic device gateway. The engine snapshots monitored items and the configured timeout, opens a detection window, and receives internal item IDs from a `DetectionProvider`. It compares those IDs with the snapshot and commits results, the alert, and the unread notification in one transaction. Socket.IO publishes completion after that commit. Item names and priorities are retained in historical records even when a belonging is renamed or deleted.

Simulation is labelled in live results, history, and reports. Actual integration can supply another `DetectionProvider` or use the generic gateway below. The doorway trigger and item detection producer can be independent.

## Deployment

The repository includes a Render Blueprint, Vercel settings, a Supabase migration, and a GitHub Actions workflow. The app follows the requested single-user model without accounts. A publicly reachable API exposes the shared workspace to anyone who can reach it. Use disposable data for a public demo, or restrict access to both the frontend and API at your hosting or network layer for personal use.

1. **GitHub.** Push the extracted source to a repository. The workflow builds and tests the app when you push.
2. **Supabase.** Apply `database/schema.sql` followed by `database/supabase-runtime.sql` in the SQL Editor. The runtime migration enables row-level security and grants each table's required permissions to `leavemate_runtime`. When the backend is ready to connect, set a private password and enable login for that role. Keep `leavemate` out of the schemas exposed through the Data API. In the Supabase Connect panel, copy the shared session pooler string on port 5432. Use the username `leavemate_runtime.<project-ref>` and the new role's password. Append `?sslmode=verify-full&sslrootcert=database%2Fsupabase-root-ca.crt` to verify the certificate and hostname with the bundled Supabase root certificate. [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)
3. **Render.** Import the repository as a Blueprint using `render.yaml`. Keep one API instance because active detection windows are process-local. Set `DATABASE_URL` to the Supabase connection string and `FRONTEND_ORIGIN` to the Vercel origin, including its scheme and omitting the trailing slash. Choose a Render service plan in the dashboard if needed. [Render Blueprint reference](https://render.com/docs/blueprint-spec)
4. **Vercel.** Import the same repository with the repository root selected, then set `VITE_API_URL` to the Render origin and deploy. Update `FRONTEND_ORIGIN` on Render if the final Vercel URL differs. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
5. Open the deployed frontend, confirm `/api/health` on Render returns `{"status":"healthy"}`, then run and acknowledge a simulated missing-item departure.

| Variable | Location | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Server only | TLS PostgreSQL connection string. Required on Render. |
| `FRONTEND_ORIGIN` | Server only | Origin allowed for browser API and Socket.IO requests. Required on Render. |
| `VITE_API_URL` | Frontend build | Render HTTPS origin. Local Vite uses its same-origin proxy. |
| `DEVICE_API_KEY` | Server and trusted device integration | Optional. Enables authenticated generic gateway requests. |
| `PORT` | Server | Local default is 4100. Render sets its service port. |

## Future device gateway

The contract below is an HTTP integration adapter. The firmware, transport from the eventual sensors to the gateway, and sensor technology remain open.

Send JSON with `x-device-key` set to the configured server secret. Use a real identifier for the producer that sends the heartbeat or departure. An accepted heartbeat or departure registers communication from that producer. The dashboard treats the last communication as stale after 90 seconds.

- `POST /api/gateway/heartbeat` takes `{"deviceId":"doorway-station"}`.
- `POST /api/gateway/departures` takes a UUID `id`, `eventType: "DEPARTURE_DETECTED"`, `source: "hardware"`, an ISO 8601 `timestamp`, and `deviceId`. The response gives the session ID and detection deadline. A duplicate ID or overlapping departure returns HTTP 409.
- `POST /api/gateway/departures/{id}/reports` takes `{"identifiers":["registered-identifier"],"complete":false}`. Reports can arrive in batches. The identifier producer sends `complete: true` when finished, with any final identifiers reported within the returned deadline. The backend only accepts detections received within the window. An empty completion report can confirm that no items were detected. A three-second grace period permits a completion signal after the deadline. Without that signal, the session fails and does not classify items as missing.
- Use `DEVICE_API_KEY` in the gateway environment, even when the actual departure trigger and identification producer are separate. The gateway is disabled until the key is configured.

## Verification

```sh
npm run build
npm test
npx playwright install chromium
npx playwright test
```

The API suite tests validation, CRUD, local persistence across reopen, Socket.IO events, simulation, the generic gateway, timeout behavior, and acknowledgement. The browser suite exercises the main workflow, CSV export, responsive navigation, and combined repeating speech with an instrumented browser speech API. Actual audio output depends on the browser, voice availability, and device settings.

The item images in `web/public/items/` were generated with the built-in image tool and cropped from one product contact sheet. See [asset brief](web/public/items/ASSETS.md).
