import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import storesRouter from './routes/stores';

const app = express();

app.use(cors());
app.use(express.json());

// Rate limit on store creation only
const createStoreLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many store creation requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.post('/api/stores', createStoreLimiter);

// Routes
app.use(storesRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Arrakis API listening on port ${PORT}`);
});
