import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin/index.html'));
});

export default router;
