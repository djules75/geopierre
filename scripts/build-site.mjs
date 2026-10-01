// Assemble le site statique dans dist/ : uniquement les fichiers servis.
import { rmSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const entry of ['index.html', 'styles.css', 'src', 'data', 'vendor']) {
  cpSync(entry, join(OUT, entry), { recursive: true });
}
const count = (dir) => readdirSync(dir).reduce((n, f) => n + (statSync(join(dir, f)).isDirectory() ? count(join(dir, f)) : 1), 0);
console.log(`dist/ : ${count(OUT)} fichiers`);
