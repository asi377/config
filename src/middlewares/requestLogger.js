export default function requestLogger(req, res, next) {
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode}`);
  });
  next();
}
