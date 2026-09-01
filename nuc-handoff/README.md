# iBOARD NUC proof-of-concept (thumb-drive handoff)

One folder to copy to a USB stick for Rob to run on a NUC.

**Ready now:** `iboard-poc.tar` (~232 MB) is already built in this folder — copy the whole `nuc-handoff/` directory to the thumb drive.

## What Rob gets

| File | Purpose |
|------|---------|
| `iboard-poc.tar` | Docker image (built on your Mac) |
| `docker-compose.yml` | Starts the app on port **3001** with persistent data |
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

3. Copy the **entire** `nuc-handoff/` folder to the thumb drive.

---

## On the NUC (Rob)

**Requirements:** Linux with Docker (Ubuntu on a NUC is fine).

```bash
cd /path/to/usb/nuc-handoff
chmod +x LOAD-AND-RUN.sh
./LOAD-AND-RUN.sh
```

Then on any laptop on the same network: **`http://<nuc-ip>:3001`**

Health check: `curl http://localhost:3001/api/health` → `{"ok":true}`

### If Docker is not on the NUC yet (Ubuntu)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
# log out and back in, then run LOAD-AND-RUN.sh again
```

---

## Firewall

Allow **TCP 3001** inbound on the NUC if classroom laptops cannot connect.

---

## Fallback (no Docker on Mac)

If you cannot build the image on the Mac, Rob can build on the NUC from the full **Feedback** source tree (same repo):

```bash
cd Feedback
docker build -t iboard:poc .
docker save iboard:poc -o iboard-poc.tar
```

Or run without Docker: see `DEPLOY.md` in the repo root (`npm run install:all`, `npm run build`, `npm start`).

---

## Stop / reset

```bash
cd nuc-handoff
docker compose down          # stop
docker compose down -v       # stop and wipe class data (careful)
```
