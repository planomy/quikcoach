# Deploy Quik Coach on a school local server

For **IT staff** or a **tech‑confident teacher**. The app is one **Node.js** process; the database is a single **SQLite file**.

---

## 1. What you need on the server PC

- **Windows, macOS, or Linux** (a small desktop or VM is fine).
- **Node.js 22 or newer** — [https://nodejs.org](https://nodejs.org) (LTS is OK if it meets `>=22.5`).
- **Network**: other computers in the school must reach this machine (same VLAN/Wi‑Fi or allowed firewall rule).

---

## 2. Copy the project onto the server

On your **dev machine** (where the project works today):

1. Copy the whole **`Feedback`** folder (or whatever you named it) to a USB drive or shared drive, **or** zip it (exclude huge folders to save time):
   - You **may delete** `client/node_modules` and `server/node_modules` before zipping — you will reinstall on the server.
2. On the **school server**, paste the folder somewhere permanent, e.g.  
   `C:\Apps\QuikCoach` (Windows) or `/opt/quik-coach` (Linux).

**Do not lose** the `server` and `client` folders and root `package.json`.

---

## 3. Install dependencies (once per deploy)

Open **Terminal** (Mac/Linux) or **Command Prompt / PowerShell** (Windows), then:

```bash
cd path\to\Feedback
```

(Replace with the real path to the project folder.)

Then run:

```bash
npm run install:all
```

That installs packages for **server** and **client**.

---

## 4. Build the web app (teacher/student pages)

Still in the project root:

```bash
npm run build
```

This creates **`client/dist`** (static HTML/JS/CSS). The **server** serves these files automatically in production.

---

## 5. Start the app

```bash
npm start --prefix server
```

Or from the project root (builds client again, then starts):

```bash
npm start
```

You should see something like: **`Quik Coach server on http://localhost:3001`**

- **Default port**: `3001` (change with environment variable `PORT`, e.g. `PORT=8080`).

---

## 6. Open it from other computers in the school

1. Find the **server’s IP address** on the LAN (e.g. `192.168.1.50`).  
   - Windows: `ipconfig`  
   - Mac/Linux: System settings or `ip addr` / `ifconfig`
2. On a **teacher or student** laptop (same network), open a browser:

   **`http://192.168.1.50:3001`**

   (Use your real IP; keep `:3001` unless you changed `PORT`.)

3. **Bookmark** that URL for the class.

**Important:** In this setup, the browser talks to **one** address for both the website and live updates (Socket.io). You do **not** need to set `VITE_SOCKET_URL` if everyone uses `http://SERVER:3001`.

---

## 7. Firewall (if it “works on the server but not in the classroom”)

Allow **inbound TCP** on the port you use (**3001** by default) on the server’s OS firewall and on any school firewall between subnets.

---

## 8. Where data is stored (backups)

- SQLite database: **`server/data/classroom.db`**
- Back up that file (copy to a safe drive) **regularly** if you care about keeping rooms and drafts.

---

## 9. Running after a reboot (keep it simple)

**Option A — manual**  
After restart, open a terminal, `cd` to the project, run:

```bash
npm start --prefix server
```

**Option B — Windows “start on login”**  
Create a `.bat` file:

```bat
cd /d C:\Apps\QuikCoach
npm start --prefix server
```

Put a shortcut to it in **Startup** (optional).

**Option B — Linux with systemd** (IT)  
Use a small service that runs `node .../server/index.js` with `WorkingDirectory` set to the project; set `Environment=PORT=3001` if needed.

---

## 10. HTTPS (optional, IT)

If the school uses **HTTPS** on a reverse proxy (e.g. nginx), the proxy must support **WebSocket** upgrades for path **`/socket.io/`**. If you only use **HTTP** on the LAN, you can skip this.

---

## 11. Checklist before a lesson

- [ ] Server is on and `npm start --prefix server` is running (or a service equivalent).  
- [ ] `http://SERVER_IP:3001` opens from a **student** laptop.  
- [ ] You know where **`classroom.db`** is for backups.

---

## Troubleshooting

| Problem | Things to check |
|--------|-------------------|
| Blank page | Run `npm run build` again; ensure `client/dist` exists. |
| “Cannot connect” from class PCs | IP, port, firewall, same Wi‑Fi/VLAN. |
| Live grid not updating | WebSockets blocked? Test HTTP first; check `/socket.io` not stripped by proxy. |
| Wrong Node version | `node -v` → need **22+** per `server/package.json`. |

---

## Updating to a new version

1. Stop the server.  
2. Replace project files (or pull from git).  
3. Run `npm run install:all` and `npm run build`.  
4. Start again with `npm start --prefix server`.  
5. Keep **`server/data/classroom.db`** if you want to preserve data (don’t delete that folder unless you intend to reset).

---

## 12. Put a link on the school SharePoint home page

SharePoint is just a **bookmark** to your Quik Coach URL. It does **not** host the app — the app still runs on your **local server** (see sections 5–6).

**Before you start**

1. Decide the exact link teachers will use, e.g. **`http://192.168.1.50:3001`** (replace with your server IP and port).  
2. Open that URL in a browser **from a teacher laptop** and confirm the site loads.  
3. If your school uses **HTTPS** and a **friendly name** (e.g. `https://quikcoach.school.internal`), use that instead — IT sets that up on a reverse proxy.

**Option A — Quick Links (most common on a modern home page)**

1. Open the **SharePoint site** (e.g. Staff Hub / school homepage).  
2. Click **Edit** (top right) on the page.  
3. Hover where you want the link, click **+** (add section or web part).  
4. Search for **Quick links** and add that web part.  
5. Click **Edit** on the Quick links web part → **Add link**.  
6. Choose **From a link** (or **Web address**).  
7. **Address / URL:** paste your Quik Coach URL (e.g. `http://192.168.1.50:3001`).  
8. **Display name:** e.g. **Quik Coach** or **Writing feedback (Quik Coach)**.  
9. Save / **Republish** the page.

**Option B — Hero or button**

Same idea: edit the page, add a **Hero** or **Button** web part, set the **link** field to your Quik Coach URL.

**Option C — Left navigation (site menu)**

1. Site **Settings** → **Change the look** → **Navigation**, or **Edit** the navigation from the site.  
2. **Add link** → paste the URL → name it **Quik Coach**.  
3. Save.

**Who can do this**

Usually a **site owner** or **SharePoint admin**. If you don’t see **Edit**, ask IT to add the link or give you edit rights on that page.

**Notes for IT**

- **HTTP** internal links sometimes trigger a browser “not secure” warning; that’s normal on a private LAN. **HTTPS** requires a certificate and often a reverse proxy — optional.  
- Teachers must be on a network that can **reach** the Quik Coach server (same issue as section 7).  
- SharePoint in the cloud (Microsoft 365) **cannot** open arbitrary `http://192.168…` links from **home** unless VPN connects them into the school network — clarify for staff: “use this link **while on school Wi‑Fi / VPN**.”
