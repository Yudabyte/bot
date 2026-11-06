const fs = require('fs');
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

const HTTP_WINDOW_MS = 5 * 60 * 1000;
const MAX_HTTP_SAMPLES = 2000;
const httpSamples = [];
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();

let cpuSnapshot = os.cpus();
let processCpuSnapshot = process.cpuUsage();
let sampledAt = Date.now();
let processCpuPercent = null;
let systemCpuPercent = null;

const cpuTimer = setInterval(() => {
  const now = Date.now();
  const elapsedMicros = Math.max(1, (now - sampledAt) * 1000);
  const nextCpus = os.cpus();
  const nextProcessCpu = process.cpuUsage();
  const systemTotal = nextCpus.reduce((total, cpu) => {
    const times = cpu.times;
    return total + times.user + times.nice + times.sys + times.irq + times.idle;
  }, 0);
  const previousTotal = cpuSnapshot.reduce((total, cpu) => {
    const times = cpu.times;
    return total + times.user + times.nice + times.sys + times.irq + times.idle;
  }, 0);
  const systemIdle = nextCpus.reduce((total, cpu) => total + cpu.times.idle, 0)
    - cpuSnapshot.reduce((total, cpu) => total + cpu.times.idle, 0);
  const processMicros = (nextProcessCpu.user - processCpuSnapshot.user)
    + (nextProcessCpu.system - processCpuSnapshot.system);

  processCpuPercent = Math.max(0, (processMicros / elapsedMicros) * 100);
  systemCpuPercent = systemTotal > previousTotal
    ? Math.max(0, Math.min(100, (1 - systemIdle / (systemTotal - previousTotal)) * 100))
    : null;
  cpuSnapshot = nextCpus;
  processCpuSnapshot = nextProcessCpu;
  sampledAt = now;
}, 1000);
cpuTimer.unref();

function recordHttpRequest(statusCode, durationMs) {
  const now = Date.now();
  httpSamples.push({ at: now, statusCode, durationMs });
  while (httpSamples.length > MAX_HTTP_SAMPLES || httpSamples[0]?.at < now - HTTP_WINDOW_MS) {
    httpSamples.shift();
  }
}

function getHttpStats() {
  const cutoff = Date.now() - HTTP_WINDOW_MS;
  while (httpSamples[0]?.at < cutoff) httpSamples.shift();
  const durations = httpSamples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const errors = httpSamples.filter((sample) => sample.statusCode >= 500).length;
  return {
    windowMinutes: HTTP_WINDOW_MS / 60000,
    requests: httpSamples.length,
    serverErrors: errors,
    serverErrorRate: httpSamples.length ? errors / httpSamples.length : 0,
    averageLatencyMs: durations.length
      ? durations.reduce((total, value) => total + value, 0) / durations.length
      : 0,
    p95LatencyMs: durations.length
      ? durations[Math.ceil(durations.length * 0.95) - 1]
      : 0,
  };
}

async function getMemoryStats() {
  const processMemory = process.memoryUsage();
  const hostTotal = os.totalmem();
  let total = hostTotal;
  let used = hostTotal - os.freemem();
  let source = 'host';

  for (const [limitPath, usagePath] of [
    ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory.current'],
    ['/sys/fs/cgroup/memory/memory.limit_in_bytes', '/sys/fs/cgroup/memory/memory.usage_in_bytes'],
  ]) {
    try {
      const [limitText, usageText] = await Promise.all([
        fs.promises.readFile(limitPath, 'utf8'),
        fs.promises.readFile(usagePath, 'utf8'),
      ]);
      const limit = Number(limitText.trim());
      const usage = Number(usageText.trim());
      if (Number.isFinite(limit) && Number.isFinite(usage) && limit > 0 && limit < hostTotal * 10) {
        total = limit;
        used = usage;
        source = 'container';
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
    }
  }

  return {
    process: {
      rssBytes: processMemory.rss,
      heapUsedBytes: processMemory.heapUsed,
      heapTotalBytes: processMemory.heapTotal,
      externalBytes: processMemory.external,
      arrayBuffersBytes: processMemory.arrayBuffers,
    },
    system: {
      totalBytes: total,
      usedBytes: used,
      freeBytes: Math.max(0, total - used),
      usagePercent: total ? Math.min(100, (used / total) * 100) : null,
      source,
    },
  };
}

async function getDiskStats() {
  if (typeof fs.promises.statfs !== 'function') return { available: false };
  try {
    const stats = await fs.promises.statfs(process.cwd());
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
      available: true,
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
      usagePercent: totalBytes ? ((totalBytes - freeBytes) / totalBytes) * 100 : null,
    };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

function getEventLoopStats() {
  const stats = {
    p95DelayMs: Number.isFinite(eventLoop.percentile(95)) ? eventLoop.percentile(95) / 1e6 : null,
    maxDelayMs: Number.isFinite(eventLoop.max) ? eventLoop.max / 1e6 : null,
  };
  eventLoop.reset();
  return stats;
}

async function getServerMetrics(botStats = {}) {
  const [memory, disk] = await Promise.all([getMemoryStats(), getDiskStats()]);
  return {
    sampledAt: new Date().toISOString(),
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      processUptimeSeconds: process.uptime(),
      hostUptimeSeconds: os.uptime(),
      pid: process.pid,
    },
    cpu: {
      processPercent: processCpuPercent,
      systemPercent: systemCpuPercent,
      cores: os.cpus().length,
      loadAverage: process.platform === 'win32' ? null : os.loadavg(),
    },
    memory,
    disk,
    eventLoop: getEventLoopStats(),
    http: getHttpStats(),
    bots: botStats,
  };
}

module.exports = { getServerMetrics, recordHttpRequest };
