# My Project

## Deployment

```bash
git pull origin main
docker build -t myapp .
docker stop myapp && docker rm myapp
docker run -d --name myapp -p 3000:3000 myapp
```
