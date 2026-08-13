// Prueba suelta del resolver de Google News, paso a paso y sin pino.
// Uso: tsx scripts/probar-gnews.ts <url>
import { cuerpoBatchExecute, idDeArticulo, urlEnRespuesta } from '../src/pipelines/script/google-news.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = process.argv[2] ?? '';
const id = idDeArticulo(url);
console.log('id:', id?.slice(0, 30));

const paginaRes = await fetch(url, { headers: { 'user-agent': UA } });
console.log('pagina HTTP', paginaRes.status);
const html = await paginaRes.text();
console.log('bytes:', html.length);
const sg = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
const ts = /data-n-a-ts="([^"]+)"/.exec(html)?.[1];
console.log('sg:', sg?.slice(0, 20), 'ts:', ts);
if (sg === undefined || ts === undefined || id === null) {
  console.log('atributos data-*:', [...html.matchAll(/data-n-[a-z-]+=/g)].slice(0, 8).map((m) => m[0]));
  process.exit(1);
}
const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
  method: 'POST',
  headers: {
    'user-agent': UA,
    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
  },
  body: cuerpoBatchExecute(id, Number(ts), sg),
});
console.log('batchexecute HTTP', res.status);
const raw = await res.text();
console.log('respuesta:', raw.slice(0, 300));
console.log('\nresuelto →', urlEnRespuesta(raw));
process.exit(0);
