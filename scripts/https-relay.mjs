/**
 * A local https front door for the test server, so Safari's engine keeps the
 * app's Secure cookie (it drops it over plain http, even on localhost).
 *
 *   node scripts/https-relay.mjs <listen-port> <server-port> <key.pem> <cert.pem>
 *
 * Any self-signed certificate will do; the checks ignore certificate errors.
 * CI makes one with openssl. It says it's forwarded from https, as Railway's
 * own front door does.
 */
import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";

const [, , listen = "3443", target = "3000", key = "key.pem", cert = "cert.pem"] = process.argv;

https
  .createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const upstream = http.request(
      { host: "127.0.0.1", port: target, path: req.url, method: req.method, headers: { ...req.headers, "x-forwarded-proto": "https" } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  })
  .listen(Number(listen), () => console.log(`https://localhost:${listen} -> ${target}`));
