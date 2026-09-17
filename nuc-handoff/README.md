# iBOARD NUC proof-of-concept (thumb-drive handoff)

One folder to copy to a USB stick for Rob to run on a NUC.

**Edge ports:** **TCP 443** (HTTPS + WebSocket) and **TCP 80** (HTTP convenience).  
App container stays on internal **3001**; Caddy proxies `/socket.io` for live class.

**Ready now:** rebuild `iboard-poc.tar` with `BUILD-ON-IMAC.sh`, then copy the whole `nuc-handoff/` directory to the thumb drive.

## What Rob gets

| File | Purpose |
|------|---------|
| `iboard-poc.tar` | Docker image (built on your Mac) |
| `docker-compose.yml` | Starts app + Caddy edge on **443** / **80** |
| `Caddyfile` | Reverse proxy (HTTPS + Socket.IO) |
| `certs/` | Self-signed TLS (`cert.pem` + `key.pem`) for port 443 |
| `LOAD-AND-RUN.sh` | Double-click or run in Terminal on the NUC |
| `README.md` | This file |

Data (SQLite + uploaded images) lives in Docker volume `iboard-data` on the NUC — survives container restarts. Caddy’s local TLS material is in `caddy-data`.

---

## On your iMac (before Rob arrives)

1. **Install Docker Desktop** if you have not already: https://www.docker.com/products/docker-desktop/  
   Open it and wait until it says **Docker is running**.

2. From the **Feedback** repo root:

   ```bash
   chmod +x nuc-handoff/BUILD-ON-IMAC.sh nuc-handoff/LOAD-AND-RUN.sh
   ./nuc-handoff/BUILD-ON-IMAC.sh
   ```

   This creates `nuc-handoff/iboard-poc.tar` (often ~400–600 MB).

3. Copy the **entire** `nuc-handoff/` folder to the thumb drive (must include `Caddyfile` and `certs/`).

---

## On the NUC (Rob)

**Requirements:** Linux with Docker (Ubuntu on a NUC is fine). First run needs internet once to pull `caddy:2-alpine`.

```bash
cd /path/to/usb/nuc-handoff
chmod +x LOAD-AND-RUN.sh
./LOAD-AND-RUN.sh
```

Then on any laptop on the same network:

- **`https://<nuc-ip>`** ← primary (port **443**, as IT asked)
- **`http://<nuc-ip>`** ← optional if TCP **80** is open

Health check:

```bash
curl -k https://localhost/api/health
# → {"ok":true}
```

HTTPS uses the **bundled self-signed certificate** in `certs/`. Chromebooks may show a warning once — Advanced → proceed to the site.

### If Docker is not on the NUC yet (Ubuntu)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# log out and back in, then run LOAD-AND-RUN.sh again
```

---

## Firewall (school IT)

| Port | Protocol | Why |
|------|----------|-----|
| **443** | TCP | Required — HTTPS + live Socket.IO (`/socket.io`) |
| **80** | TCP | Optional — HTTP without cert warning |

Do **not** need to open **3001** on the NUC firewall; that port stays inside Docker.

Proxy note for IT: path **`/socket.io/`** must allow **WebSocket upgrade** (Caddy does this by default).

---

## Fallback (no Docker on Mac)

If you cannot build the image on the Mac, Rob can build on the NUC from the full **Feedback** source tree (same repo):

```bash
cd Feedback
docker build -t iboard:poc .
docker save iboard:poc -o iboard-poc.tar
```

Then use this folder’s `docker-compose.yml` + `Caddyfile` + `LOAD-AND-RUN.sh` as usual.

Or run without Docker: see `DEPLOY.md` in the repo root (`npm run install:all`, `npm run build`, `npm start`) — that path still defaults to port **3001** unless you put a reverse proxy in front.

---

## Stop / reset

```bash
cd nuc-handoff
docker compose down          # stop
docker compose down -v       # stop and wipe class + Caddy data (careful)
```
