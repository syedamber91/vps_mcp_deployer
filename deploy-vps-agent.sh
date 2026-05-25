#!/bin/bash
set -e

VPS_HOST="${VPS_HOST:-187.77.185.22}"
VPS_USER="${VPS_USER:-syamiq}"
REMOTE_DIR="/local/data/scrath/vps-agent"

echo "=== Building VPS Agent ==="
cd "$(dirname "$0")/vps-agent"
npm ci
npm run build
cd ..

echo "=== Copying files to VPS ==="
ssh ${VPS_USER}@${VPS_HOST} "sudo mkdir -p ${REMOTE_DIR}"
scp -r vps-agent/dist ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-dist
scp vps-agent/package.json vps-agent/package-lock.json ${VPS_USER}@${VPS_HOST}:/tmp/
scp vps-agent/Dockerfile ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-Dockerfile
scp -r shared ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-shared
scp .env ${VPS_USER}@${VPS_HOST}:/tmp/vps-agent-env

echo "=== Building Docker image on VPS ==="
ssh ${VPS_USER}@${VPS_HOST} << 'REMOTE'
REMOTE_DIR="/local/data/scrath/vps-agent"
sudo cp -r /tmp/vps-agent-dist ${REMOTE_DIR}/dist
sudo cp /tmp/package.json /tmp/package-lock.json ${REMOTE_DIR}/
sudo cp /tmp/vps-agent-Dockerfile ${REMOTE_DIR}/Dockerfile
sudo cp -r /tmp/vps-agent-shared ${REMOTE_DIR}/shared
sudo cp /tmp/vps-agent-env ${REMOTE_DIR}/.env

cd ${REMOTE_DIR}
sudo docker build -t vps-agent .
sudo docker stop vps-agent 2>/dev/null || true
sudo docker rm vps-agent 2>/dev/null || true
sudo docker run -d --name vps-agent --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /local/data/scrath/docker-data:/workspace \
  -p 127.0.0.1:7847:7847 \
  --env-file .env \
  vps-agent

echo "=== VPS Agent deployed ==="
sudo docker ps | grep vps-agent
REMOTE

echo "Done! VPS agent is running on 127.0.0.1:7847"
