/**
 * Helpers para la "medicación en curso" del titular (User.currentMedications, JSON).
 * Se usa desde el bot de WhatsApp (cargar medicamento / confirmar receta), la web y
 * la ficha de emergencia.
 */

export interface Medication {
  name: string;
  dose?: string;
  frequency?: string;
  /** Texto libre: "desde marzo", "post-operatorio", una fecha… */
  since?: string;
  /** De dónde salió el dato. */
  source: 'manual' | 'receta' | 'photo';
  addedAt: string;
}

/** Normaliza para comparar nombres (sin tildes, sin puntuación, minúsculas). */
export const normName = (s: string): string =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function parseMedications(raw?: string | null): Medication[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m: any) => m && typeof m.name === 'string' && m.name.trim())
      .map((m: any) => ({
        name: String(m.name).trim(),
        dose: m.dose ? String(m.dose).trim() : undefined,
        frequency: m.frequency ? String(m.frequency).trim() : undefined,
        since: m.since ? String(m.since).trim() : undefined,
        source: (['manual', 'receta', 'photo'].includes(m.source) ? m.source : 'manual') as Medication['source'],
        addedAt: m.addedAt || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

/**
 * Fusiona `incoming` sobre `existing` deduplicando por nombre normalizado: si ya
 * existe la droga se actualizan dosis/frecuencia/desde (sin pisar con vacío), si
 * no, se agrega.
 */
export function mergeMedications(
  existing: Medication[],
  incoming: Array<Partial<Medication> & { name?: string }>,
  source: Medication['source']
): { list: Medication[]; added: string[]; updated: string[] } {
  const list: Medication[] = existing.map((m) => ({ ...m }));
  const added: string[] = [];
  const updated: string[] = [];

  for (const inc of incoming) {
    const name = (inc.name || '').trim();
    if (!name) continue;
    const idx = list.findIndex((m) => normName(m.name) === normName(name));
    if (idx >= 0) {
      const cur = list[idx];
      list[idx] = {
        ...cur,
        dose: (inc.dose && inc.dose.trim()) || cur.dose,
        frequency: (inc.frequency && inc.frequency.trim()) || cur.frequency,
        since: (inc.since && inc.since.trim()) || cur.since,
        source,
      };
      if (!updated.includes(cur.name)) updated.push(cur.name);
    } else {
      list.push({
        name,
        dose: inc.dose && inc.dose.trim() ? inc.dose.trim() : undefined,
        frequency: inc.frequency && inc.frequency.trim() ? inc.frequency.trim() : undefined,
        since: inc.since && inc.since.trim() ? inc.since.trim() : undefined,
        source,
        addedAt: new Date().toISOString(),
      });
      added.push(name);
    }
  }
  return { list, added, updated };
}

/** Saca de la lista toda medicación cuyo nombre matchee (substring en cualquier sentido). */
export function removeMedication(
  existing: Medication[],
  query: string
): { list: Medication[]; removed: string[] } {
  const q = normName(query);
  if (!q) return { list: existing, removed: [] };
  const removed: string[] = [];
  const list = existing.filter((m) => {
    const n = normName(m.name);
    const hit = n.includes(q) || q.includes(n);
    if (hit) removed.push(m.name);
    return !hit;
  });
  return { list, removed };
}

/** Lista para WhatsApp / texto plano. */
export function formatMedications(list: Medication[], opts: { max?: number } = {}): string {
  if (!list.length) return '';
  const max = opts.max ?? 25;
  const rows = list.slice(0, max).map((m) => {
    const bits = [m.dose, m.frequency].filter(Boolean).join(' · ');
    return `• *${m.name}*${bits ? ` — ${bits}` : ''}`;
  });
  if (list.length > max) rows.push(`… y ${list.length - max} más`);
  return rows.join('\n');
}

/**
 * Familias de fármacos para detectar un choque cuando la alergia está escrita por
 * la familia ("alérgico a la penicilina") y el medicamento es un miembro
 * ("Amoxicilina"), o viceversa. Intencionalmente corto y conservador.
 */
const FAMILIES: Array<{ family: RegExp; member: RegExp; label: string }> = [
  {
    family: /penicilin|betalact|cefalospor/,
    member: /amoxicilin|amoxi|ampicilin|penicilin|cefalexin|cefadroxil|cefuroxim|ceftriaxon|cefixim|piperacilin|dicloxacilin/,
    label: 'betalactámicos / penicilinas',
  },
  {
    family: /aine|antiinflamatori|ains/,
    member: /ibuprofen|naproxen|diclofenac|ketorolac|aspirin|acido acetilsalicilic|acetilsalicil|meloxicam|piroxicam|ketoprofen|celecoxib/,
    label: 'AINEs',
  },
  {
    family: /sulfa|sulfonamid/,
    member: /sulfametoxazol|cotrimoxazol|trimetoprim sulfa|sulfadiazin|sulfasalazin/,
    label: 'sulfamidas',
  },
  { family: /dipirona|metamizol/, member: /dipirona|metamizol/, label: 'dipirona / metamizol' },
  { family: /yodo|contraste yodad/, member: /yodo|amiodarona|povidona yodad/, label: 'yodo' },
];

/**
 * Devuelve advertencias legibles si algún medicamento en curso choca con las
 * alergias severas o los medicamentos contraindicados de la ficha.
 */
export function medicationConflicts(
  meds: Medication[],
  allergies?: string | null,
  contraindicated?: string | null
): string[] {
  const haystack = normName(`${allergies || ''} ${contraindicated || ''}`);
  if (!haystack.trim() || !meds.length) return [];
  const out: string[] = [];

  for (const m of meds) {
    const n = normName(m.name);
    if (!n) continue;

    const directHit =
      haystack.includes(n) ||
      n.split(' ').some((w) => w.length > 4 && haystack.includes(w));
    if (directHit) {
      out.push(`*${m.name}* figura en tus alergias o medicamentos contraindicados`);
      continue;
    }

    for (const f of FAMILIES) {
      const medIsMember = f.member.test(n);
      const fichaHasFamily = f.family.test(haystack) || f.member.test(haystack);
      if (medIsMember && fichaHasFamily) {
        out.push(`*${m.name}* es del grupo ${f.label}, que tu ficha marca como riesgoso`);
        break;
      }
    }
  }
  return Array.from(new Set(out));
}
