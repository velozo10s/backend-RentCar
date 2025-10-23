import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/** Crea un XLSX con hasta 3 hojas: aggregates, groups/items planos */
export async function buildXlsxBuffer(payload) {
  const wb = new ExcelJS.Workbook();
  const agg = wb.addWorksheet('aggregates');
  agg.addRow(['key', 'value']);
  for (const [k, v] of Object.entries(payload.aggregates || {})) {
    agg.addRow([k, typeof v === 'object' ? JSON.stringify(v) : v]);
  }

  if (payload.groups) {
    const ws = wb.addWorksheet('groups');
    ws.addRow(['group_key', 'count', 'payload']);
    for (const g of payload.groups) {
      ws.addRow([g.status || g.month || '', g.count || '', JSON.stringify(g)]);
    }
  }

  if (payload.items) {
    const ws2 = wb.addWorksheet('items');
    const keys = payload.items[0] ? Object.keys(payload.items[0]) : [];
    if (keys.length) ws2.addRow(keys);
    for (const it of payload.items || []) {
      ws2.addRow(keys.map(k => typeof it[k] === 'object' ? JSON.stringify(it[k]) : it[k]));
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** PDF simple (resumen) */
export async function buildSimplePdfBuffer(payload, title = 'report') {
  const doc = new PDFDocument({size: 'A4', margin: 40});
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(title, {underline: true});
    doc.moveDown();

    doc.fontSize(12).text('Aggregates:');
    doc.moveDown(0.5);
    doc.font('Courier').fontSize(10).text(JSON.stringify(payload.aggregates || {}, null, 2));
    doc.moveDown();

    if (payload.groups) {
      doc.font('Helvetica').fontSize(12).text('Groups:');
      doc.moveDown(0.5);
      doc.font('Courier').fontSize(10).text(JSON.stringify(payload.groups || [], null, 2));
    } else if (payload.items) {
      doc.font('Helvetica').fontSize(12).text('Items:');
      doc.moveDown(0.5);
      doc.font('Courier').fontSize(10).text(JSON.stringify(payload.items || [], null, 2));
    }

    doc.end();
  });
}

/** Contrato PDF (plantilla mínima — puedes estilizarla) */
export async function buildContractPdfBuffer(data) {
  const doc = new PDFDocument({size: 'A4', margin: 40});
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Rental Contract', {align: 'center'});
    doc.moveDown();

    doc.fontSize(12).text(`Reservation ID: ${data.id}`);
    doc.text(`Customer: ${data.first_name} ${data.last_name} (Doc: ${data.document_number})`);
    doc.text(`Period: ${data.start_at} to ${data.end_at}`);
    doc.text(`Total: ${data.total_amount}`);
    doc.moveDown();

    doc.fontSize(12).text('Vehicles:');
    for (const it of data.items || []) {
      doc.text(`- Vehicle ID: ${it.vehicle_id} | Line Amount: ${it.line_amount}`);
    }

    doc.moveDown();
    doc.fontSize(10).text('Terms & Conditions: ...');
    doc.end();
  });
}
