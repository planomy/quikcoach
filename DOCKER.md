# iBOARD Docker runtime

This repository includes a portable Docker image for the existing iBOARD/QuikCoach application.

The container does not change the application architecture. It still runs one Node/Express/Socket.IO server, serves the built React client, and uses SQLite plus board media on persistent storage.

## Build

```bash
docker build -t iboard .
```

## Run locally

```bash
docker run --rm \
  -p 3001:3001 \
  -e PORT=3001 \
  -e DATA_DIR=/data \
  -v iboard-data:/data \
  iboard
```

Then open `http://localhost:3001`.

Health check:

```bash
curl http://localhost:3001/api/health
```

Expected response:

```json
{"ok":true}
```

## Persistent data

`DATA_DIR` must point to storage that survives container replacement. iBOARD currently stores both of these beneath that directory:

- `classroom.db` (SQLite database)
- `board-media/` (student and teacher images/drawings)

The Docker image defaults `DATA_DIR` to `/data`. Mount persistent storage there, or override `DATA_DIR` and mount the chosen path.

Do not store important data only inside the container filesystem. Containers should be disposable; `/data` is the part that must persist.

## Railway

The current production Railway deployment remains configured for **Nixpacks** in `railway.json`. Adding the Dockerfile does not intentionally switch the live service to Docker.

When the Docker image has been tested and production is ready to move, Railway can be changed to build from the repository Dockerfile while keeping the existing persistent volume mounted at the same `DATA_DIR` location.

Before switching production, confirm:

1. the Railway volume contains the current SQLite database and `board-media` directory;
2. `DATA_DIR` inside the Docker deployment points at that mounted volume;
3. the health endpoint returns `{"ok":true}`;
4. a teacher and student can join a test room, type, draw/upload an image, refresh, and recover the same data.

## AWS / Azure portability

The same image can later run on a container service such as AWS ECS/App Runner or Azure Container Apps/App Service for Containers.

For the current single-instance SQLite architecture, the container must still have persistent writable storage mounted at `DATA_DIR`.

Before iBOARD scales horizontally to multiple simultaneous app replicas, move shared state away from local SQLite/files (for example PostgreSQL plus object storage, with Redis only if/when needed). Dockerisation itself does not require that migration.

## CI

`.github/workflows/docker-build.yml` builds the Docker image for relevant pull requests and pushes to `main`. It validates that the image can be constructed but does not publish it to a registry.
