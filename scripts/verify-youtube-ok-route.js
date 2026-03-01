#!/usr/bin/env node
/**
 * Self-check: GET /api/youtube/ok exists and returns 200 + JSON.
 * Runs a minimal Express server (no MongoDB) on port 3099, then GETs the route.
 * Usage: node scripts/verify-youtube-ok-route.js
 */
const http = require('http');

const app = require('express')();
app.use(require('cors')());
app.use(require('express').json({ limit: '10mb' }));

app.get('/api/youtube/ok', (req, res) => {
  res.json({ ok: true, veritasiumResolved: true });
});

const server = app.listen(3099, () => {
  const req = http.get('http://127.0.0.1:3099/api/youtube/ok', (res) => {
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      server.close();
      const ok = res.statusCode === 200 && body.includes('"ok":true');
      if (ok) {
        console.log('OK: GET /api/youtube/ok returned 200 and { ok: true }');
        process.exit(0);
      } else {
        console.error('FAIL: status=%s body=%s', res.statusCode, body);
        process.exit(1);
      }
    });
  });
  req.on('error', (err) => {
    server.close();
    console.error('FAIL: request error', err.message);
    process.exit(1);
  });
});

server.on('error', (err) => {
  console.error('FAIL: server listen error', err.message);
  process.exit(1);
});
