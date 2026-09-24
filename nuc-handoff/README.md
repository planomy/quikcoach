# iBOARD NUC proof-of-concept (thumb-drive handoff)

One folder to copy to a USB stick for Rob to run on a NUC.

**Edge port:** **TCP 80** only (HTTP + WebSocket / Socket.IO).  
No TLS and **no port 443** — the app container maps host **80 → 3001**.

**Ready now:** rebuild `iboard-poc.tar` with `BUILD-ON-IMAC.sh`, then copy the whole `nuc-handoff/` directory to the thumb drive.

## What Rob gets

| File | Purpose |
|------|---------|
| `iboard-poc.tar` | Docker image (built on your Mac) |
| `docker-compose.yml` | Starts the app on **TCP 80** |
| `LOAD-AND-RUN.sh` | Double-click or run in Terminal on the NUC |
| `README.md` | This file |

Data (SQLite + uploaded images) lives in Docker volume `iboard-data` on the NUC — survives container restarts.

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

3. Copy the **entire** `nuc-handoff/` folder to the thumb drive (must include `iboard-poc.tar` and `docker-compose.yml`).

---

## On the NUC (Rob)

**Requirements:** Linux with Docker (Ubuntu on a NUC is fine). Offline after the image is loaded — no extra edge image pull.

```bash
cd /path/to/usb/nuc-handoff
chmod +x LOAD-AND-RUN.sh
./LOAD-AND-RUN.sh
```

Then on any laptop on the same network:

- **`http://<nuc-ip>/`** ← primary (port **80**)

Health check:

```bash
curl http://localhost/api/health
# → {"ok":true}
```

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
| **80** | TCP | Required — HTTP + live Socket.IO (`/socket.io`) |

Do **not** open **443** or **3001**. Port 3001 stays inside Docker; 443 is unused in this package.

Proxy note for IT (if something sits in front later): path **`/socket.io/`** must allow **WebSocket upgrade**.

---

## Fallback (no Docker on Mac)

If you cannot build the image on the Mac, Rob can build on the NUC from the full **Feedback** source tree (same repo):

```bash
cd Feedback
docker build -t iboard:poc .
docker save iboard:poc -o iboard-poc.tar
```

Then use this folder’s `docker-compose.yml` + `LOAD-AND-RUN.sh` as usual.

Or run without Docker: see `DEPLOY.md` in the repo root (`npm run install:all`, `npm run build`, `npm start`) — that path still defaults to port **3001** unless you put a reverse proxy in front.

---

## Stop / reset

```bash
cd nuc-handoff
docker compose down          # stop
docker compose down -v       # stop and wipe class data (careful)
```
