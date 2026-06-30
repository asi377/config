// In-memory per-user anti-spam. Each user may send up to BURST messages within
// WINDOW_MS; beyond that, extra updates are dropped (and callback queries get a
// quiet answer so the loading spinner stops). A short DEBOUNCE_MS also swallows
// accidental double-taps of the same button. Single-process only — good enough
// for this bot; swap for Redis if it ever runs multi-instance.
const WINDOW_MS = 4000;
const BURST = 6;
const DEBOUNCE_MS = 350;
const _hits = new Map(); // userId -> { times: number[], last: number, lastData: string }

// Periodic cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [id, rec] of _hits) {
    if (rec.last < cutoff) _hits.delete(id);
  }
}, 60000).unref?.();

export async function botRateLimit(ctx, next) {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const now = Date.now();
  const data = ctx.callbackQuery?.data || ctx.message?.text || '';
  let rec = _hits.get(userId);
  if (!rec) { rec = { times: [], last: 0, lastData: '' }; _hits.set(userId, rec); }

  // Swallow identical rapid double-taps of the same button/text.
  if (data && data === rec.lastData && now - rec.last < DEBOUNCE_MS) {
    if (ctx.callbackQuery) { try { await ctx.answerCbQuery(); } catch { /* ignore */ } }
    return; // drop
  }

  rec.times = rec.times.filter((tms) => now - tms < WINDOW_MS);
  rec.times.push(now);
  rec.last = now;
  rec.lastData = data;

  if (rec.times.length > BURST) {
    if (ctx.callbackQuery) { try { await ctx.answerCbQuery('⏳'); } catch { /* ignore */ } }
    return; // drop — too many requests in the window
  }

  return next();
}

export function createRateLimiter(options = {}) {
  const { windowMs = 60000, max = 100 } = options;
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();

    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const userRequests = requests.get(key).filter((t) => now - t < windowMs);
    userRequests.push(now);
    requests.set(key, userRequests);

    if (userRequests.length > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}
