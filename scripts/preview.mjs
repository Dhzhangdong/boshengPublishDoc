import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from './server.mjs';
const config = JSON.parse(await fs.readFile('products.json', 'utf8'));
const product = process.argv[2] || config.products[0].id;
if (!config.products.some(p => p.id === product)) throw new Error('产品标识不存在');
const port = Number(process.env.PORT || 18120);
const server = createServer(path.resolve('dist'), product);
server.listen(port, '127.0.0.1', () => console.log(`预览 http://127.0.0.1:${port}/doc/`));
