import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root, 'dist'), { recursive: true });
await mkdir(path.join(root, 'build'), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['renderer/pet.jsx', 'renderer/settings.jsx'],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  outdir: 'dist', charset: 'utf8', minify: true, legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
});
for (const file of ['pet.html', 'settings.html', 'styles.css']) {
  await copyFile(path.join(root, 'renderer', file), path.join(root, 'dist', file));
}
await mkdir(path.join(root, 'dsh-bridge/lib'), { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['dsh-bridge/src/client.js'],
  outfile: 'dsh-bridge/lib/client.js', bundle: true, format: 'iife',
  platform: 'browser', target: 'es2022', charset: 'utf8', minify: false,
});
// ICO embeds a 256px PNG. Keep the original image untouched.
const original = PNG.sync.read(await readFile(path.join(root, '../assets/plugin-logo.png')));
const icon = new PNG({ width: 256, height: 256 });
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
  const from = (Math.min(original.height - 1, Math.floor(y * original.height / 256)) * original.width
    + Math.min(original.width - 1, Math.floor(x * original.width / 256))) * 4;
  original.data.copy(icon.data, (y * 256 + x) * 4, from, from + 4);
}
const png = PNG.sync.write(icon);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await writeFile(path.join(root, 'build/icon.ico'), Buffer.concat([header, png]));
await mkdir(path.join(root, '../release'), { recursive: true });
await copyFile(path.join(root, 'README.md'), path.join(root, '../release/使用说明.md'));
console.log('Built desktop renderer, DSH bridge and application icon. No tests run.');
