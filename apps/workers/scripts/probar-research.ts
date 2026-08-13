import pino from 'pino';
import { downloadSources } from '../src/pipelines/script/research.js';
const url = process.argv[2] ?? '';
const logger = pino({ level: 'silent' });
const docs = await downloadSources(logger, [{ url }], false);
console.log('texto:', docs[0]?.text.length, 'chars · url final:', docs[0]?.url?.slice(0, 60));
process.exit(0);
