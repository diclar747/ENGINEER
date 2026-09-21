import { describe, expect, it } from 'vitest';
import { buildReportPdf, buildZipParts, safeFileName } from '../services/download-pack.service';

const file = (name: string, bytes: number) => ({ name, buffer: Buffer.alloc(bytes, 7) });

describe('buildZipParts', () => {
  it('un solo paquete cuando todo entra', async () => {
    const parts = await buildZipParts([file('a.pdf', 100), file('b.pdf', 100)], 'Bio-Pass documentos', 1000);
    expect(parts).toHaveLength(1);
    expect(parts[0].filename).toBe('Bio-Pass documentos.zip');
    expect(parts[0].contains).toEqual(['a.pdf', 'b.pdf']);
    expect(parts[0].buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('corta por partes numeradas y no pierde ningún archivo', async () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`doc-${i}.pdf`, 400));
    const parts = await buildZipParts(files, 'Bio-Pass documentos', 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].filename).toBe(`Bio-Pass documentos - parte 1 de ${parts.length}.zip`);
    const todos = parts.flatMap((p) => p.contains);
    expect(todos).toHaveLength(10);
    expect(new Set(todos).size).toBe(10);
  });

  it('un archivo más grande que el tope va solo, nunca partido', async () => {
    const parts = await buildZipParts([file('chico.pdf', 100), file('enorme.pdf', 5000)], 'X', 1000);
    expect(parts).toHaveLength(2);
    expect(parts[0].contains).toEqual(['chico.pdf']);
    expect(parts[1].contains).toEqual(['enorme.pdf']);
  });

  it('nombres repetidos no se pisan dentro del zip', async () => {
    const parts = await buildZipParts([file('Estudio.pdf', 10), file('Estudio.pdf', 10)], 'X', 100000);
    expect(parts[0].contains).toEqual(['Estudio.pdf', 'Estudio.pdf']);
    // El segundo entra al zip renombrado — el zip no queda con dos entradas iguales.
    expect(parts[0].buffer.toString('latin1')).toContain('Estudio (2).pdf');
  });

  it('sin archivos no arma nada', async () => {
    expect(await buildZipParts([], 'X')).toEqual([]);
  });
});

describe('safeFileName', () => {
  it('saca lo que rompe un nombre de archivo', () => {
    expect(safeFileName('Estudio: sangre / 05/01/2021')).toBe('Estudio sangre 05 01 2021');
    expect(safeFileName('')).toBe('documento');
    expect(safeFileName('x'.repeat(200)).length).toBe(70);
  });
});

describe('buildReportPdf', () => {
  it('genera un PDF válido con las secciones pedidas', async () => {
    const pdf = await buildReportPdf({
      title: 'Recordatorios de medicación',
      userName: 'Juan Francisco González',
      subtitle: 'Período: del 05/01/2021 al 30/04/2021',
      sections: [
        { heading: 'Recordatorios (1)', lines: ['• Losartán 50 mg — 08:00, 20:00'] },
        { heading: 'Sin nada', lines: [] },
      ],
    });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });
});
