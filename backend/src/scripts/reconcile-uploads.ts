/**
 * Concilia los archivos de `uploads/medical_studies` contra la tabla MedicalStudy.
 *
 * Por qué existe: hasta v128 el bot descartaba por tiempo casi toda una ráfaga de
 * cargas, y algunos archivos llegaban a escribirse en disco sin que se creara la
 * fila correspondiente (o quedaban como `pending_*`, esperando una categoría que
 * nunca llegó porque el mensaje siguiente se había perdido). Esos archivos existen
 * pero son invisibles: no se listan ni se pueden descargar.
 *
 * Uso (dentro del contenedor del backend, que ya tiene DATABASE_URL):
 *
 *   node dist/scripts/reconcile-uploads.js            # solo informa, no toca nada
 *   node dist/scripts/reconcile-uploads.js --import   # crea las filas faltantes
 *
 * El modo informe es el predeterminado a propósito: primero se mira, después se
 * decide. `--import` solo AGREGA filas; nunca borra un archivo ni modifica los
 * registros que ya existen.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../database/prisma';
import { config } from '../config';

const FOLDER = 'medical_studies';

/** `<prefijo>_<userId>_<epoch>.<ext>` — así los nombra StorageService. */
function parseName(name: string): { prefix: string; userId: string; ts: number } | null {
  const m = name.match(/^(study|rx|med|pending)_([0-9a-f-]{36})_(\d{10,})\./i);
  if (!m) return null;
  return { prefix: m[1].toLowerCase(), userId: m[2], ts: Number(m[3]) };
}

const titleFor = (prefix: string, at: Date): string => {
  const fecha = at.toLocaleDateString('es-PY', { timeZone: config.timezone });
  if (prefix === 'rx') return `Receta médica ${fecha}`;
  if (prefix === 'med') return `Foto de medicamento ${fecha}`;
  return `Documento médico ${fecha}`;
};

async function main(): Promise<void> {
  const doImport = process.argv.includes('--import');
  const dir = path.join(config.storage.uploadDir, FOLDER);
  if (!fs.existsSync(dir)) {
    console.log(`No existe ${dir}. Nada que conciliar.`);
    return;
  }

  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
  const rows = await prisma.medicalStudy.findMany({ select: { id: true, fileUrl: true, userId: true } });
  // Se compara por NOMBRE de archivo: el `fileUrl` guardado trae el baseUrl del
  // momento, que cambió de dominio más de una vez.
  const referenced = new Set(rows.map((r) => (r.fileUrl || '').split('/').pop() || '').filter(Boolean));

  const huerfanos: Array<{ file: string; size: number; info: ReturnType<typeof parseName> }> = [];
  for (const f of files) {
    if (referenced.has(f)) continue;
    huerfanos.push({ file: f, size: fs.statSync(path.join(dir, f)).size, info: parseName(f) });
  }

  // Filas que apuntan a un archivo que ya no está en disco (el caso inverso).
  const enDisco = new Set(files);
  const rotas = rows.filter((r) => {
    const n = (r.fileUrl || '').split('/').pop() || '';
    return n && !enDisco.has(n);
  });

  console.log(`\n=== Conciliación de ${FOLDER} ===`);
  console.log(`Archivos en disco : ${files.length}`);
  console.log(`Filas en la base  : ${rows.length}`);
  console.log(`Huérfanos (archivo sin fila) : ${huerfanos.length}`);
  console.log(`Rotas (fila sin archivo)     : ${rotas.length}\n`);

  const usuarios = new Set<string>();
  for (const h of huerfanos) {
    const u = h.info?.userId || '???';
    usuarios.add(u);
    const cuando = h.info ? new Date(h.info.ts).toISOString().slice(0, 16).replace('T', ' ') : '?';
    console.log(`  · ${h.file}  (${(h.size / 1024).toFixed(0)} KB, ${cuando}, usuario ${u.slice(0, 8)})`);
  }
  if (rotas.length) {
    console.log('');
    for (const r of rotas) console.log(`  ⚠️ fila ${r.id.slice(0, 8)} apunta a ${(r.fileUrl || '').split('/').pop()} — el archivo no está`);
  }

  if (!doImport) {
    console.log(
      huerfanos.length
        ? `\nSolo informe. Para crear las ${huerfanos.length} fila(s) faltante(s):  node dist/scripts/reconcile-uploads.js --import\n`
        : '\nNada para importar.\n'
    );
    return;
  }

  let creadas = 0;
  let salteadas = 0;
  for (const h of huerfanos) {
    if (!h.info) {
      console.log(`  ⏭️  ${h.file}: no puedo deducir de quién es (nombre fuera de formato) — lo dejo como está.`);
      salteadas++;
      continue;
    }
    const existe = await prisma.user.findUnique({ where: { id: h.info.userId }, select: { id: true } });
    if (!existe) {
      console.log(`  ⏭️  ${h.file}: el usuario ${h.info.userId.slice(0, 8)} ya no existe — lo dejo como está.`);
      salteadas++;
      continue;
    }
    const at = new Date(h.info.ts);
    await prisma.medicalStudy.create({
      data: {
        userId: h.info.userId,
        title: titleFor(h.info.prefix, at),
        studyType: h.info.prefix === 'rx' ? 'PRESCRIPTION' : 'OTHER',
        studyDate: at,
        createdAt: at,
        fileUrl: `${config.baseUrl}/uploads/${FOLDER}/${h.file}`,
      },
    });
    creadas++;
    console.log(`  ✅ ${h.file} → recuperado para ${h.info.userId.slice(0, 8)}`);
  }
  console.log(`\nListo: ${creadas} recuperado(s), ${salteadas} salteado(s). Usuarios afectados: ${usuarios.size}.\n`);
}

main()
  .catch((e) => {
    console.error('Falló la conciliación:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
