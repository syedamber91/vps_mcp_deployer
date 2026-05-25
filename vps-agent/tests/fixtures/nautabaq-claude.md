# NauTabaq Stock Investing Platform

## Deployment (VPS — Hostinger)

**VPS**: `syamiq@187.77.185.22` | Project dir: `/local/data/scrath/docker-data`

### Frontend Deploy (most common)

```bash
sudo docker build --no-cache --build-arg NEXT_PUBLIC_FRONTEND_URL=https://nautabaq.duckdns.org --build-arg NEXT_PUBLIC_BACKEND_URL=https://nautabaq.duckdns.org/api -t stock-frontend ./webapp/frontend
sudo docker stop docker-data-frontend-1 && sudo docker rm docker-data-frontend-1
sudo docker run -d --name docker-data-frontend-1 --restart unless-stopped --network docker-data_stock-net --network-alias frontend -e NEO4J_URI=bolt://neo4j:7687 -e NEO4J_USER=neo4j -e NEO4J_PASSWORD=stockanalysis2026 -e POSTGRES_HOST=postgres -e POSTGRES_PORT=5432 -e POSTGRES_DB=stock_analyzer -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres stock-frontend
```

### Git Pull on VPS

```bash
sudo docker run --rm --entrypoint sh -v /local/data/scrath/docker-data:/repo -w /repo alpine/git -c 'git config --global --add safe.directory /repo && git pull origin develop'
```
