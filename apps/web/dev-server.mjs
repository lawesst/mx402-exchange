import { readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import next from 'next';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT ?? '3002');
const hostname = process.env.HOSTNAME ?? 'localhost';
const dev = true;

const certificateDir = path.join(__dirname, 'certificates');
const key = readFileSync(path.join(certificateDir, 'localhost-key.pem'));
const cert = readFileSync(path.join(certificateDir, 'localhost.pem'));

const app = next({
  dev,
  dir: __dirname,
  hostname,
  port
});

const handle = app.getRequestHandler();

app.prepare().then(() => {
  https
    .createServer(
      {
        key,
        cert
      },
      (req, res) => handle(req, res)
    )
    .listen(port, hostname, () => {
      console.log(`> MX402 web ready on https://${hostname}:${port}`);
    });
});
