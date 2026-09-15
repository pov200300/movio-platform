# Automated Legal Media Platform Architecture

This repository hosts the multi-tier automated legal media streaming platform. The platform is architected for deployment across **2 separate VPS instances** to isolate high-bandwidth automation and media processing from the user-facing presentation and CMS layer.

---

## 📁 Repository Folder Structure

```
my_web_film/
├── vps1-frontend-cms/             # [VPS 1] Presentation & Content Management Environment
│   ├── docker-compose.yml         # Compose config for Nginx, Next.js, WordPress, MariaDB
│   └── nginx/
│       └── default.conf           # Reverse proxy configuration (Routes / to Next.js, /wp-admin to WP)
│
├── vps2-automation-worker/        # [VPS 2] Media Processing & Automation Environment
│   ├── docker-compose.yml         # Compose config for Python Worker, qBittorrent, Sonarr
│   └── worker/
│       └── Dockerfile             # Custom Python 3.11 + FFmpeg container
│
├── frontend/                      # Next.js App Source Code (Mounted to VPS 1 container)
│   ├── app/
│   ├── components/
│   ├── Dockerfile.dev
│   └── package.json
│
├── fetchers/                      # Python Worker Modules (Mounted to VPS 2 container)
├── processors/
├── publishers/
├── uploaders/
├── models/
├── config/
├── utils/
├── main.py                        # Python Worker Main Orchestrator Entrypoint
└── requirements.txt
```

---

## 🚀 Environment 1: Frontend & CMS (VPS 1)

### Included Services:
1. **Nginx (`http://localhost:8080`)**: Reverse proxy managing incoming traffic.
2. **Next.js (`http://localhost:3000`)**: Frontend web application running in development mode (`npm run dev`) with live hot-reloading.
3. **WordPress (`http://localhost:8080/wp-admin`)**: Headless CMS serving media metadata via REST API.
4. **MariaDB**: Relational database for WordPress storage.

### How to Run Locally:

```bash
# Navigate to Environment 1
cd vps1-frontend-cms

# Start all containers in background
docker compose up -d

# View container status
docker compose ps

# View live logs for Next.js or WordPress
docker compose logs -f frontend
```

---

## ⚙️ Environment 2: Automation Worker (VPS 2)

### Included Services:
1. **Python Worker**: Custom Python 3.11 container pre-loaded with FFmpeg, executing `main.py`. Local scripts are volume-mapped for live coding.
2. **qBittorrent (`http://localhost:8081`)**: Download client powered by `linuxserver/qbittorrent`.
3. **Sonarr (`http://localhost:8989`)**: Media management service powered by `linuxserver/sonarr`.

### How to Run Locally:

```bash
# Navigate to Environment 2
cd vps2-automation-worker

# Start worker and automation tools
docker compose up -d

# View live Python worker logs
docker compose logs -f worker
```

---

## 🛠️ Development Workflow

- **Frontend Development**: Edit files inside `./frontend`. Next.js automatically reloads changes inside the Docker container without needing container restarts.
- **Python Scripting**: Edit files in the project root (`main.py`, `fetchers/`, `processors/`, etc.). Volume mapping continuously synchronizes your changes into the `legal_media_worker` container.
- **Full Local Testing**: Both Environment 1 and Environment 2 can run simultaneously on your local machine without port conflicts.
