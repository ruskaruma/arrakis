import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import { configureGitHub } from './auth/github';
import { isAuthenticated } from './auth/middleware';
import storesRouter from './routes/stores';
import { spec as openapiSpec } from './openapi';

const app = express();

app.use(cors({
  origin: process.env.DASHBOARD_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET must be set in production');
  process.exit(1);
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'arrakis-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());
configureGitHub();

app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/auth/failed' }),
  (_req, res) => {
    res.redirect(process.env.DASHBOARD_URL || 'http://localhost:5173');
  }
);

app.get('/auth/me', (req, res) => {
  if (process.env.SKIP_AUTH === 'true') {
    res.json({ user: { id: 'dev', username: 'developer', displayName: 'Developer', avatar: '' } });
    return;
  }
  if (req.isAuthenticated()) {
    res.json({ user: req.user });
    return;
  }
  res.status(401).json({ user: null });
});

app.post('/auth/logout', (req, res) => {
  req.logout(() => {
    res.json({ ok: true });
  });
});

app.get('/auth/failed', (_req, res) => {
  res.status(401).json({ error: 'Authentication failed' });
});

const createStoreLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many store creation requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.post('/api/stores', createStoreLimiter);

app.use('/api', isAuthenticated);
app.use(storesRouter);

app.get('/api/docs/spec', (_req, res) => {
  res.json(openapiSpec);
});

app.get('/api/docs', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html><head><title>Arrakis API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head><body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/docs/spec', dom_id: '#swagger-ui' });</script>
</body></html>`);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Arrakis API listening on port ${PORT}`);
});
