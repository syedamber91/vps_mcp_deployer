import express from "express";
import { authMiddleware } from "./auth.js";
import { handleDeploy } from "./handlers/deploy.js";
import { handleRunJob } from "./handlers/jobs.js";
import {
  handleDockerStatus,
  handleDockerLogs,
  handleDiskUsage,
  handleGitStatus,
  handleServiceHealth,
} from "./handlers/query.js";
import { executeCommand } from "./executor.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

// Health check — no auth
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Auth for all subsequent routes
app.use(authMiddleware);

// Deploy
app.post("/deploy", async (req, res) => {
  try {
    const result = await handleDeploy(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Run job
app.post("/run-job", async (req, res) => {
  try {
    const result = await handleRunJob(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Docker status
app.get("/docker-status", async (_req, res) => {
  try {
    const result = await handleDockerStatus();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Docker logs
app.get("/docker-logs/:container", async (req, res) => {
  try {
    const lines = parseInt(req.query.lines as string) || 100;
    const result = await handleDockerLogs(req.params.container, lines);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Disk usage
app.get("/disk-usage", async (_req, res) => {
  try {
    const result = await handleDiskUsage();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Git status
app.get("/git-status", async (req, res) => {
  try {
    const result = await handleGitStatus(req.query.working_directory as string | undefined);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Service health
app.get("/service-health", async (req, res) => {
  try {
    const rawUrls = req.query.urls as string | undefined;
    const urls = rawUrls ? rawUrls.split(",") : undefined;
    const result = await handleServiceHealth(urls);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// DB health — checks Neo4j and Postgres
app.get("/db-health", async (_req, res) => {
  try {
    const [neo4j, postgres] = await Promise.all([
      executeCommand("curl -sf http://neo4j:7474 || echo 'UNREACHABLE'"),
      executeCommand("docker exec docker-data-postgres-1 pg_isready"),
    ]);
    res.json({
      success: true,
      data: {
        neo4j: { success: neo4j.success, output: neo4j.stdout?.trim() || neo4j.stderr?.trim() },
        postgres: { success: postgres.success, output: postgres.stdout?.trim() || postgres.stderr?.trim() },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

const PORT = parseInt(process.env.VPS_AGENT_PORT || "7847", 10);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`VPS agent listening on 127.0.0.1:${PORT}`);
});
