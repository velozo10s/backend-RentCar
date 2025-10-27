import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import dotenv from 'dotenv';
import QRCode from 'qrcode';

dotenv.config();

const STATUS_MAP_ES = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  active: 'Activa',
  completed: 'Finalizada',
  declined: 'Rechazada',
  cancelled: 'Cancelada',
};
const capitalize = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
const formatReservationStatus = (val) => {
  if (!val) return '—';
  const key = String(val).toLowerCase().trim();
  // Si viene con underscores, los hacemos espacio para fallback legible
  return STATUS_MAP_ES[key] ?? capitalize(key.replace(/_/g, ' '));
};


/** =========================
 * Helpers comunes (XLSX)
 * ========================= */

function addTableSheet(
  wb,
  name,
  columns,
  rows,
  {headerFill = 'FFEEEEEE', autoFilter = true} = {}
) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 20,
  }));
  if (rows?.length) ws.addRows(rows);

  // Estilos header
  const header = ws.getRow(1);
  header.font = {bold: true};
  header.fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: headerFill}};
  header.alignment = {vertical: 'middle', horizontal: 'center'};
  header.height = 18;

  if (autoFilter) {
    ws.autoFilter = {
      from: {row: 1, column: 1},
      to: {row: 1, column: columns.length},
    };
  }

  // Ajuste de números/fechas básico
  columns.forEach((c, idx) => {
    if (c.numFmt) {
      ws.getColumn(idx + 1).numFmt = c.numFmt;
    }
    if (c.alignment) {
      ws.getColumn(idx + 1).alignment = c.alignment;
    }
  });

  return ws;
}

/** =========================
 * XLSX por tipo de reporte (en ES)
 * ========================= */

function xlsxReservationStatus(payload) {
  const wb = new ExcelJS.Workbook();

  // 1) Resumen por estado
  const summaryRows = Object.entries(payload.aggregates?.byStatus || {}).map(
    ([estado, cantidad]) => ({estado, cantidad})
  );
  addTableSheet(
    wb,
    'Resumen por Estado',
    [
      {header: 'Estado', key: 'estado', width: 24},
      {header: 'Cantidad', key: 'cantidad', width: 12, alignment: {horizontal: 'right'}},
    ],
    summaryRows
  );

  // 2) Reservas
  const reservas = (payload.groups || []).flatMap((g) =>
    (g.reservations || []).map((r) => ({
      id: r.id,
      estado: r.status,
      cliente: r.customer_name,
      inicio: r.start_at,
      fin: r.end_at,
      total: Number(r.total_amount),
      nota: r.note || '',
      items: Array.isArray(r.items) ? r.items.length : 0,
    }))
  );
  addTableSheet(
    wb,
    'Reservas',
    [
      {header: 'ID de Reserva', key: 'id', width: 16},
      {header: 'Estado', key: 'estado', width: 16},
      {header: 'Cliente', key: 'cliente', width: 28},
      {header: 'Inicio', key: 'inicio', width: 22},
      {header: 'Fin', key: 'fin', width: 22},
      {header: 'Total', key: 'total', width: 14, numFmt: '#,##0.00', alignment: {horizontal: 'right'}},
      {header: 'Nota', key: 'nota', width: 40},
      {header: 'Ítems', key: 'items', width: 10, alignment: {horizontal: 'right'}},
    ],
    reservas
  );

  // 3) Ítems
  const items = (payload.groups || [])
    .flatMap((g) => (g.reservations || [])
      .flatMap((r) => (r.items || []).map((it) => ({
        id_reserva: r.id,
        id_vehiculo: it.vehicle_id,
        importe_linea: Number(it.line_amount),
      })))
    );
  addTableSheet(
    wb,
    'Ítems',
    [
      {header: 'ID de Reserva', key: 'id_reserva', width: 16},
      {header: 'ID de Vehículo', key: 'id_vehiculo', width: 14},
      {header: 'Importe Ítem', key: 'importe_linea', width: 16, numFmt: '#,##0.00', alignment: {horizontal: 'right'}},
    ],
    items
  );

  return wb;
}

function xlsxMonthlyRevenue(payload) {
  const wb = new ExcelJS.Workbook();

  // 1) Resumen (serie mensual)
  const series = (payload.aggregates?.series || []).map((s) => ({
    mes: s.month,
    ingresos: Number(s.revenue),
  }));
  addTableSheet(
    wb,
    'Resumen Mensual',
    [
      {header: 'Mes', key: 'mes', width: 16},
      {header: 'Ingresos', key: 'ingresos', width: 16, numFmt: '#,##0.00', alignment: {horizontal: 'right'}},
    ],
    series
  );

  // 2) Reservas por Mes
  const rows = (payload.groups || []).flatMap((g) =>
    (g.reservations || []).map((r) => ({
      mes: g.month,
      id_reserva: r.id,
      id_cliente: r.customer_user_id,
      estado: r.status,
      inicio: r.start_at,
      fin: r.end_at,
      total: Number(r.total_amount),
    }))
  );
  addTableSheet(
    wb,
    'Reservas por Mes',
    [
      {header: 'Mes', key: 'mes', width: 16},
      {header: 'ID de Reserva', key: 'id_reserva', width: 16},
      {header: 'ID de Cliente', key: 'id_cliente', width: 18},
      {header: 'Estado', key: 'estado', width: 14},
      {header: 'Inicio', key: 'inicio', width: 22},
      {header: 'Fin', key: 'fin', width: 22},
      {header: 'Total', key: 'total', width: 14, numFmt: '#,##0.00', alignment: {horizontal: 'right'}},
    ],
    rows
  );

  return wb;
}

function xlsxUpcomingMaintenance(payload) {
  const wb = new ExcelJS.Workbook();

  // 1) Resumen de buckets
  const b = payload.aggregates?.buckets || {};
  addTableSheet(
    wb,
    'Resumen',
    [
      {header: 'Bucket', key: 'bucket', width: 24},
      {header: 'Cantidad', key: 'count', width: 12, alignment: {horizontal: 'right'}},
    ],
    [
      {bucket: 'vencido (<=0 km)', count: b.overdue || 0},
      {bucket: '< 500 km', count: b.lt_500 || 0},
      {bucket: '500–1000 km', count: b.gte_500_lt_1000 || 0},
      {bucket: 'Total', count: payload.aggregates?.total || 0},
    ]
  );

  // 2) Vehículos
  addTableSheet(
    wb,
    'Vehículos',
    [
      {header: 'ID Vehículo', key: 'id', width: 12},
      {header: 'Marca', key: 'brand', width: 18},
      {header: 'Modelo', key: 'model', width: 18},
      {header: 'Año', key: 'year', width: 10, alignment: {horizontal: 'right'}},
      {header: 'Patente', key: 'license_plate', width: 14},
      {header: 'Km.', key: 'mileage', width: 12, alignment: {horizontal: 'right'}},
      {header: 'Próx. Servicio', key: 'maintenance_mileage', width: 14, alignment: {horizontal: 'right'}},
      {header: 'Km Restantes', key: 'km_remaining', width: 14, alignment: {horizontal: 'right'}},
      {header: 'Estado', key: 'status', width: 16},
      {header: 'Activo', key: 'is_active', width: 10},
    ],
    payload.items || []
  );

  return wb;
}

function xlsxFrequentCustomers(payload) {
  const wb = new ExcelJS.Workbook();

  // 1) Clientes
  const rows = (payload.items || []).map((r) => ({
    id_usuario: r.user_id,
    cliente: r.customer_name,
    documento: r.document_number,
    reservas: Number(r.reservation_count),
  }));
  addTableSheet(
    wb,
    'Clientes',
    [
      {header: 'ID Usuario', key: 'id_usuario', width: 12},
      {header: 'Cliente', key: 'cliente', width: 28},
      {header: 'Documento', key: 'documento', width: 16},
      {header: 'Reservas', key: 'reservas', width: 14, alignment: {horizontal: 'right'}},
    ],
    rows
  );

  // 2) Detalle de Reservas
  const reservas = (payload.items || []).flatMap((r) =>
    (r.reservations || []).map((rv) => ({
      id_usuario: r.user_id,
      cliente: r.customer_name,
      id_reserva: rv.id,
      inicio: rv.start_at,
      fin: rv.end_at,
      total: Number(rv.total_amount),
    }))
  );
  addTableSheet(
    wb,
    'Reservas',
    [
      {header: 'ID Usuario', key: 'id_usuario', width: 12},
      {header: 'Cliente', key: 'cliente', width: 28},
      {header: 'ID de Reserva', key: 'id_reserva', width: 16},
      {header: 'Inicio', key: 'inicio', width: 22},
      {header: 'Fin', key: 'fin', width: 22},
      {header: 'Total', key: 'total', width: 14, numFmt: '#,##0.00', alignment: {horizontal: 'right'}},
    ],
    reservas
  );

  return wb;
}

/** API principal XLSX: nameBase decide layout */
export async function buildXlsxBuffer(payload, nameBase = 'report') {
  let wb;
  switch (nameBase) {
    case 'reservation_status':
      wb = xlsxReservationStatus(payload);
      break;
    case 'monthly_revenue':
      wb = xlsxMonthlyRevenue(payload);
      break;
    case 'upcoming_maintenance':
      wb = xlsxUpcomingMaintenance(payload);
      break;
    case 'frequent_customers':
      wb = xlsxFrequentCustomers(payload);
      break;
    default: {
      // Fallback genérico en ES
      wb = new ExcelJS.Workbook();
      addTableSheet(
        wb,
        'Agregados',
        [
          {header: 'clave', key: 'key', width: 30},
          {header: 'valor', key: 'value', width: 60},
        ],
        Object.entries(payload.aggregates || {}).map(([k, v]) => ({
          key: k,
          value: typeof v === 'object' ? JSON.stringify(v) : v,
        }))
      );

      if (payload.groups?.length) {
        addTableSheet(
          wb,
          'Grupos',
          [
            {header: 'grupo', key: 'group_key', width: 24},
            {header: 'cantidad', key: 'count', width: 10},
            {header: 'payload', key: 'payload', width: 80},
          ],
          payload.groups.map((g) => ({
            group_key: g.status || g.month || '',
            count: g.count || '',
            payload: JSON.stringify(g),
          }))
        );
      }

      if (payload.items?.length) {
        const keys = Object.keys(payload.items[0] || {});
        const ws = wb.addWorksheet('Ítems');
        ws.addRow(keys);
        for (const it of payload.items)
          ws.addRow(keys.map((k) => (typeof it[k] === 'object' ? JSON.stringify(it[k]) : it[k])));
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** =========================
 * PDF helpers (tabla simple) — EN ESPAÑOL + mejor ajuste ancho
 * ========================= */

/**
 * Ajusta el ancho total de columnas para caber en availableWidth:
 * 1) Escala proporcionalmente.
 * 2) Aplica mínimos.
 * 3) Si aún no entra, re-escala por debajo del mínimo como último recurso.
 */
function normalizeColumnsToWidth(
  doc,
  columns,
  availableWidth,
  {minColWidth = 50} = {}
) {
  const total = columns.reduce((a, c) => a + c.width, 0);
  if (total <= availableWidth) return columns.map((c) => ({...c}));

  // 1) Escala proporcional inicial
  const scale = availableWidth / total;
  let scaled = columns.map((c) => ({
    ...c,
    width: Math.max(Math.floor(c.width * scale), minColWidth),
  }));

  // 2) Si aún excede por mínimos, intentar reducción proporcional ignorando mínimos (fallback duro)
  let sum = scaled.reduce((a, c) => a + c.width, 0);
  if (sum > availableWidth) {
    const scale2 = availableWidth / sum;
    scaled = scaled.map((c) => ({
      ...c,
      width: Math.max(Math.floor(c.width * scale2), 30), // nunca menos de 30 para que el texto quepa con elipsis
    }));
  }

  return scaled;
}

function drawTableDynamic(
  doc,
  startX,
  startY,
  columns,
  rows,
  {
    headerFill = '#eeeeee',
    padding = 4,
    zebra = true,
    baseRowHeight = 18,
    fontSize = 9,
    headerFontSize = 10,
    maxY = 770,
  } = {}
) {
  // Ajustar columnas al ancho útil
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const availableWidth = pageWidth - (startX - doc.page.margins.left);
  const cols = normalizeColumnsToWidth(doc, columns, availableWidth);

  let y = startY;

  // Header
  doc.save();
  doc.rect(startX, y, cols.reduce((a, c) => a + c.width, 0), baseRowHeight).fill(headerFill).restore();
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(headerFontSize);
  let x = startX;
  for (const col of cols) {
    doc.text(col.header, x + padding, y + 3, {width: col.width - padding * 2, ellipsis: true});
    x += col.width;
  }
  y += baseRowHeight;

  // Rows
  doc.font('Helvetica').fontSize(fontSize);

  const drawHeaderOnNewPage = () => {
    // Nueva página + repetir header
    doc.addPage();
    y = doc.y = 40;
    doc.save();
    doc.rect(startX, y, cols.reduce((a, c) => a + c.width, 0), baseRowHeight).fill(headerFill).restore();
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(headerFontSize);
    let hx = startX;
    for (const c of cols) {
      doc.text(c.header, hx + padding, y + 3, {width: c.width - padding * 2, ellipsis: true});
      hx += c.width;
    }
    y += baseRowHeight;
    doc.font('Helvetica').fontSize(fontSize);
  };

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];

    // Alto real de la fila: máximo alto entre columnas (wrapping)
    let rowHeight = baseRowHeight;
    for (const col of cols) {
      const val = r[col.key] != null ? String(r[col.key]) : '';
      const h = doc.heightOfString(val, {
        width: col.width - padding * 2,
        align: 'left',
      });
      rowHeight = Math.max(rowHeight, h + padding * 2);
    }

    if (y + rowHeight > maxY) {
      drawHeaderOnNewPage();
    }

    if (zebra && idx % 2 === 0) {
      doc.save();
      doc
        .rect(startX, y, cols.reduce((a, c) => a + c.width, 0), rowHeight)
        .fill('#f9f9f9')
        .restore();
    }

    let cx = startX;
    doc.fillColor('#000');
    for (const col of cols) {
      const val = r[col.key] != null ? String(r[col.key]) : '';
      doc.text(val, cx + padding, y + 4, {width: col.width - padding * 2});
      cx += col.width;
    }
    y += rowHeight;
  }

  return y;
}

/** API principal PDF: ahora en español */
export async function buildSimplePdfBuffer(payload, title = 'report', options = {}) {
  // Para mantenimiento, si no especifican orientación, usar landscape por defecto (muchas columnas)
  const inferLandscape =
    title === 'upcoming_maintenance' && !options.orientation;

  const orientation =
    (options.orientation || (inferLandscape ? 'landscape' : 'portrait')).toLowerCase() === 'landscape'
      ? 'landscape'
      : 'portrait';

  const fontSize = options.fontSize || 9;
  const compact = !!options.compact;

  const doc = new PDFDocument({size: 'A4', margin: 40, layout: orientation});
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Utilidades
    const fmtDateTime = (v) => {
      const d = new Date(v);
      if (Number.isNaN(+d)) return String(v ?? '');
      // Mostrar local-friendly
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    };

    switch (title) {
      case 'reservation_status': {
        doc.fontSize(16).text('Estados de Reserva', {underline: true});
        doc.moveDown(0.6);

        // Resumen
        const summary = Object.entries(payload.aggregates?.byStatus || {}).map(
          ([estado, cantidad]) => ({estado, cantidad})
        );
        drawTableDynamic(
          doc,
          40,
          doc.y + 6,
          [
            {header: 'Estado', key: 'estado', width: 220},
            {header: 'Cantidad', key: 'cantidad', width: 100},
          ],
          summary,
          {fontSize, headerFontSize: 11}
        );
        doc.moveDown(0.6);

        // Reservas
        const reservas = (payload.groups || []).flatMap((g) =>
          (g.reservations || []).map((r) => ({
            id: r.id,
            estado: r.status,
            cliente: r.customer_name,
            inicio: fmtDateTime(r.start_at),
            fin: fmtDateTime(r.end_at),
            total: Number(r.total_amount).toFixed(2),
            items: Array.isArray(r.items) ? r.items.length : 0,
          }))
        );

        const columns = compact
          ? [
            {header: 'ID', key: 'id', width: 60},
            {header: 'Estado', key: 'estado', width: 90},
            {header: 'Inicio', key: 'inicio', width: 120},
            {header: 'Fin', key: 'fin', width: 120},
            {header: 'Total', key: 'total', width: 80},
            {header: 'Ítems', key: 'items', width: 60},
          ]
          : [
            {header: 'ID', key: 'id', width: 60},
            {header: 'Estado', key: 'estado', width: 90},
            {header: 'Cliente', key: 'cliente', width: 180},
            {header: 'Inicio', key: 'inicio', width: 130},
            {header: 'Fin', key: 'fin', width: 130},
            {header: 'Total', key: 'total', width: 80},
            {header: 'Ítems', key: 'items', width: 60},
          ];

        doc.fontSize(12).text('Reservas');
        drawTableDynamic(doc, 40, doc.y + 6, columns, reservas, {fontSize, headerFontSize: 11});
        break;
      }

      case 'monthly_revenue': {
        doc.fontSize(16).text('Ingresos Mensuales', {underline: true});
        doc.moveDown(0.6);

        const series = (payload.aggregates?.series || []).map((s) => ({
          mes: s.month,
          ingresos: Number(s.revenue).toFixed(2),
        }));

        drawTableDynamic(
          doc,
          40,
          doc.y + 6,
          [
            {header: 'Mes', key: 'mes', width: 180},
            {header: 'Ingresos', key: 'ingresos', width: 120},
          ],
          series,
          {fontSize, headerFontSize: 11}
        );
        doc.moveDown(0.6);

        // Reservas por mes
        const rows = (payload.groups || []).flatMap((g) =>
          (g.reservations || []).map((r) => ({
            mes: fmtDateTime(g.month).slice(0, 7), // YYYY-MM
            id_reserva: r.id,
            estado: r.status,
            inicio: fmtDateTime(r.start_at),
            fin: fmtDateTime(r.end_at),
            total: Number(r.total_amount).toFixed(2),
          }))
        );

        const columns = compact
          ? [
            {header: 'Mes', key: 'mes', width: 90},
            {header: 'ID Reserva', key: 'id_reserva', width: 80},
            {header: 'Estado', key: 'estado', width: 80},
            {header: 'Total', key: 'total', width: 80},
          ]
          : [
            {header: 'Mes', key: 'mes', width: 110},
            {header: 'ID Reserva', key: 'id_reserva', width: 100},
            {header: 'Estado', key: 'estado', width: 90},
            {header: 'Inicio', key: 'inicio', width: 130},
            {header: 'Fin', key: 'fin', width: 130},
            {header: 'Total', key: 'total', width: 90},
          ];

        doc.fontSize(12).text('Reservas por Mes');
        drawTableDynamic(doc, 40, doc.y + 6, columns, rows, {fontSize, headerFontSize: 11});
        break;
      }

      case 'upcoming_maintenance': {
        doc.fontSize(16).text('Mantenimiento Próximo', {underline: true});
        doc.moveDown(0.6);

        const b = payload.aggregates?.buckets || {};
        const summary = [
          {bucket: 'vencido (<=0 km)', cantidad: b.overdue || 0},
          {bucket: '< 500 km', cantidad: b.lt_500 || 0},
          {bucket: '500–1000 km', cantidad: b.gte_500_lt_1000 || 0},
          {bucket: 'Total', cantidad: payload.aggregates?.total || 0},
        ];
        drawTableDynamic(
          doc,
          40,
          doc.y + 6,
          [
            {header: 'Bucket', key: 'bucket', width: 220},
            {header: 'Cantidad', key: 'cantidad', width: 100},
          ],
          summary,
          {fontSize, headerFontSize: 11}
        );
        doc.moveDown(0.6);

        // Tabla de vehículos — en ES y con normalización de ancho mejorada
        const cols = compact
          ? [
            {header: 'ID', key: 'id', width: 50},
            {header: 'Marca', key: 'brand', width: 90},
            {header: 'Modelo', key: 'model', width: 110},
            {header: 'Km Rest.', key: 'km_remaining', width: 70},
          ]
          : [
            {header: 'ID', key: 'id', width: 55},
            {header: 'Marca', key: 'brand', width: 90},
            {header: 'Modelo', key: 'model', width: 110},
            {header: 'Año', key: 'year', width: 50},
            {header: 'Patente', key: 'license_plate', width: 80},
            {header: 'Kilometraje', key: 'mileage', width: 80},
            {header: 'Próx. Serv.', key: 'maintenance_mileage', width: 85},
            {header: 'Km Rest.', key: 'km_remaining', width: 80},
            {header: 'Estado', key: 'status', width: 80},
            {header: 'Activo', key: 'is_active', width: 60},
          ];

        const vehRows = (payload.items || []).map((r) => ({
          id: r.id,
          brand: r.brand,
          model: r.model,
          year: r.year,
          license_plate: r.license_plate,
          mileage: r.mileage,
          maintenance_mileage: r.maintenance_mileage,
          km_remaining: r.km_remaining,
          status: r.status,
          is_active: r.is_active ? 'Sí' : 'No',
        }));

        drawTableDynamic(doc, 40, doc.y + 6, cols, vehRows, {fontSize, headerFontSize: 11});
        break;
      }

      case 'frequent_customers': {
        doc.fontSize(16).text('Clientes Frecuentes', {underline: true});
        doc.moveDown(0.6);

        const clientes = (payload.items || []).map((r) => ({
          id_usuario: r.user_id,
          cliente: r.customer_name,
          documento: r.document_number,
          reservas: Number(r.reservation_count),
        }));

        const cols = compact
          ? [
            {header: 'Usuario', key: 'id_usuario', width: 60},
            {header: 'Cliente', key: 'cliente', width: 200},
            {header: 'Reservas', key: 'reservas', width: 70},
          ]
          : [
            {header: 'ID Usuario', key: 'id_usuario', width: 80},
            {header: 'Cliente', key: 'cliente', width: 220},
            {header: 'Documento', key: 'documento', width: 130},
            {header: 'Reservas', key: 'reservas', width: 90},
          ];

        drawTableDynamic(doc, 40, doc.y + 6, cols, clientes, {fontSize, headerFontSize: 11});
        doc.addPage();

        doc.fontSize(12).text('Reservas');
        const reservas = (payload.items || []).flatMap((r) =>
          (r.reservations || []).map((rv) => ({
            id_usuario: r.user_id,
            id_reserva: rv.id,
            inicio: fmtDateTime(rv.start_at),
            fin: fmtDateTime(rv.end_at),
            total: Number(rv.total_amount).toFixed(2),
          }))
        );

        const cols2 = compact
          ? [
            {header: 'Usuario', key: 'id_usuario', width: 60},
            {header: 'ID Reserva', key: 'id_reserva', width: 80},
            {header: 'Total', key: 'total', width: 80},
          ]
          : [
            {header: 'ID Usuario', key: 'id_usuario', width: 80},
            {header: 'ID Reserva', key: 'id_reserva', width: 110},
            {header: 'Inicio', key: 'inicio', width: 140},
            {header: 'Fin', key: 'fin', width: 140},
            {header: 'Total', key: 'total', width: 90},
          ];

        drawTableDynamic(doc, 40, doc.y + 6, cols2, reservas, {fontSize, headerFontSize: 11});
        break;
      }

      default: {
        doc.fontSize(16).text('Reporte', {underline: true});
        doc.moveDown(0.5);
        drawTableDynamic(
          doc,
          40,
          doc.y + 6,
          [{header: 'JSON', key: 'json', width: 500}],
          [{json: JSON.stringify(payload).slice(0, 4000) + '…'}],
          {fontSize}
        );
      }
    }

    doc.end();
  });
}

export async function buildContractPdfBuffer(data) {
  const {
    COMPANY_NAME = 'Tu Empresa S.A.',
    COMPANY_RUC = 'RUC 0000000-0',
    COMPANY_ADDRESS = 'Dirección, Ciudad, País',
    COMPANY_PHONE = '+595 000 000 000',
    COMPANY_EMAIL = 'info@tuempresa.com',
    COMPANY_WEBSITE = 'https://tuempresa.com',
    COMPANY_LOGO_PATH,
  } = process.env;

  // --------- Normalizadores ---------
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? null;

  const reservationId = pick(data?.id, data?.reservation_id, data?.code);
  const reservationStatus = pick(data?.status, data?.state, data?.reservation_status);
  const startAt = pick(data?.start_at, data?.start, data?.from, data?.pickup_at);
  const endAt = pick(data?.end_at, data?.end, data?.to, data?.return_at);
  const totalAmount = Number(pick(data?.total_amount, data?.total, data?.amount_total, data?.grand_total, 0));
  const note = pick(data?.note, data?.notes, data?.comment);

  const customer = data?.customer || data?.client || data?.customer_user || {};
  const firstName = pick(data?.first_name, customer?.first_name, data?.customer_first_name);
  const lastName = pick(data?.last_name, customer?.last_name, data?.customer_last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || pick(customer?.name, data?.customer_name, '—');
  const documentNumber = pick(data?.document_number, customer?.document_number, data?.document, data?.dni, '—');
  const phone = pick(data?.phone, customer?.phone, data?.customer_phone);
  const email = pick(data?.email, customer?.email, data?.customer_email);

  const rawItems = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.vehicles)
      ? data.vehicles
      : [];
  const items = rawItems.map((it) => ({
    vehicle_id: pick(it.vehicle_id, it.id, '—'),
    brand_name: pick(it.brand_name, it.brand, ''),
    model: pick(it.model, it.model_name, '(sin detalle)'),
    license_plate: pick(it.license_plate, it.plate, '—'),
    year: pick(it.year, it.model_year, '—'),
    line_amount: Number(pick(it.line_amount, it.amount, it.price, 0)),
  }));
  const subtotal = items.reduce((a, b) => a + Number(b.line_amount || 0), 0);

  // --------- PDF base ---------
  const doc = new PDFDocument({size: 'A4', margin: 46, bufferPages: true});
  const chunks = [];
  const PALETTE = {
    primary: '#0F6CBD',
    primarySoft: '#E8F1FB',
    border: '#D9DFE7',
    text: '#111',
    textMuted: '#666',
    zebra: '#FAFBFD',
  };
  const SP = {xs: 4, sm: 8, md: 12, lg: 18, xl: 26};

  const fmtCurrency = (n) =>
    new Intl.NumberFormat('es-PY', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(Number(n || 0));

  const fmtDateTime = (dt) => {
    if (!dt) return '—';
    const d = new Date(dt);
    const fFecha = new Intl.DateTimeFormat('es-PY', {day: '2-digit', month: '2-digit', year: 'numeric'}).format(d);
    const fHora = new Intl.DateTimeFormat('es-PY', {hour: '2-digit', minute: '2-digit'}).format(d);
    return `${fFecha} ${fHora}`;
  };

  const hr = (y = doc.y, color = PALETTE.border) => {
    doc.save()
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.width - doc.page.margins.right, y)
      .lineWidth(1).strokeColor(color).stroke()
      .restore();
    doc.moveDown(0.5);
  };

  const roundedRect = (x, y, w, h, r = 6, fill = null, stroke = PALETTE.border) => {
    doc.save();
    doc.lineWidth(1).roundedRect(x, y, w, h, r);
    if (fill) doc.fillColor(fill).fill();
    if (stroke) doc.lineWidth(1).strokeColor(stroke).roundedRect(x, y, w, h, r).stroke();
    doc.restore();
  };

  const drawHeaderBand = () => {
    const bandH = 60;
    const w = doc.page.width;
    doc.save().rect(0, 0, w, bandH).fill(PALETTE.primary).restore();

    const logoY = 14;
    if (COMPANY_LOGO_PATH) {
      try {
        doc.image(COMPANY_LOGO_PATH, doc.page.margins.left, logoY, {height: 32});
      } catch {
      }
    } else {
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text(COMPANY_NAME, doc.page.margins.left, logoY + 8);
    }
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(16)
      .text('CONTRATO DE ALQUILER DE VEHÍCULO', 0, logoY + 6, {
        align: 'right',
        width: w - doc.page.margins.left - doc.page.margins.right
      });
    doc.fillColor(PALETTE.text);
    doc.y = bandH + SP.md;
  };

  const ensureSpace = (needed = 80) => {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeaderBand();
    }
  };

  // --------- Cards SIN tapar texto (miden altura antes) ---------
  const renderInfoCard = (title, lines) => {
    const x = doc.page.margins.left;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pad = 10;

    // header
    const headerY = doc.y;
    const headerH = 24;
    roundedRect(x, headerY, w, headerH, 8, PALETTE.primarySoft, PALETTE.border);
    doc.fillColor(PALETTE.text).font('Helvetica-Bold').fontSize(11)
      .text(title, x + pad, headerY + 6);

    // construir el cuerpo como string para medir
    const bodyText = lines.join('\n');
    const textOpts = {width: w - pad * 2, align: 'left'};
    doc.font('Helvetica').fontSize(10);
    const textH = Math.max(32, doc.heightOfString(bodyText, textOpts)); // altura estimada

    // body (detrás)
    const bodyY = headerY + headerH;
    roundedRect(x, bodyY, w, textH + pad * 1.2, 8, '#fff', PALETTE.border);

    // texto (encima del body)
    doc.fillColor(PALETTE.text).font('Helvetica').fontSize(10)
      .text(bodyText, x + pad, bodyY + pad / 1.2, textOpts);

    // mover cursor
    doc.y = bodyY + textH + pad * 1.2 + SP.md;
    doc.fillColor(PALETTE.text);
  };

  // --------- Tabla con y-base por fila ---------
  const drawTable = ({headers, rows, colWidths, aligns}) => {
    const x0 = doc.page.margins.left;
    const xMax = doc.page.width - doc.page.margins.right;
    const rowH = 18;
    const padX = 6;

    const header = () => {
      const y0 = doc.y;
      doc.save();
      doc.rect(x0, y0, xMax - x0, rowH).fill(PALETTE.primarySoft).restore();
      doc.lineWidth(1).strokeColor(PALETTE.border).moveTo(x0, y0 + rowH).lineTo(xMax, y0 + rowH).stroke();
      let x = x0;
      headers.forEach((h, i) => {
        const w = colWidths[i];
        doc.font('Helvetica-Bold').fontSize(9).fillColor(PALETTE.text)
          .text(h, x + padX, y0 + 4, {width: w - padX * 2, align: aligns[i] || 'left'});
        x += w;
      });
      doc.y = y0 + rowH;
    };

    const row = (cells, zebra) => {
      const y0 = doc.y;
      if (zebra) {
        doc.save();
        doc.rect(x0, y0, xMax - x0, rowH).fill(PALETTE.zebra).restore();
      }
      let x = x0;
      cells.forEach((c, i) => {
        const w = colWidths[i];
        doc.font('Helvetica').fontSize(9).fillColor(PALETTE.text)
          .text(String(c ?? ''), x + padX, y0 + 4, {width: w - padX * 2, align: aligns[i] || 'left'});
        x += w;
      });
      doc.save().lineWidth(0.5).strokeColor(PALETTE.border).moveTo(x0, y0 + rowH).lineTo(xMax, y0 + rowH).stroke().restore();
      doc.y = y0 + rowH;
    };

    header();
    rows.forEach((r, idx) => {
      ensureSpace(rowH * 2);
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        drawHeaderBand();
        header();
      }
      row(r, idx % 2 === 1);
    });
  };

  // --------- Firmas absolutas ---------
  const drawSignature = (x, y, w, title, subtitle) => {
    doc.save().strokeColor('#000').moveTo(x, y).lineTo(x + w, y).stroke().restore();
    doc.fillColor(PALETTE.text).fontSize(10).text(title, x, y + 6, {width: w, align: 'center'});
    doc.fillColor(PALETTE.text).fontSize(9).text(subtitle || '', x, y + 20, {width: w, align: 'center'});
  };

  // const addFooter = () => {
  //   const range = doc.bufferedPageRange();
  //   for (let i = range.start; i < range.start + range.count; i++) {
  //     doc.switchToPage(i);
  //     const y = doc.page.height - 34;
  //     const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  //     doc.fontSize(8).fillColor(PALETTE.textMuted);
  //     doc.text(`${COMPANY_NAME} · ${COMPANY_ADDRESS} · ${COMPANY_PHONE} · ${COMPANY_EMAIL}`, doc.page.margins.left, y, {
  //       width: w,
  //       align: 'center'
  //     });
  //     doc.text(`Página ${i + 1} de ${range.count}`, doc.page.margins.left, y + 10, {width: w, align: 'center'});
  //   }
  //   doc.fillColor(PALETTE.text);
  // };

  // --------- Stream ---------
  return await new Promise(async (resolve, reject) => {
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeaderBand();

    // QR (opcional)
    if (data?.reservation_url) {
      try {
        const qr = await QRCode.toBuffer(data.reservation_url, {margin: 0, scale: 4});
        const rightX = doc.page.width - doc.page.margins.right - 120;
        doc.image(qr, rightX, doc.y, {width: 110});
        doc.fontSize(8).fillColor(PALETTE.textMuted)
          .text('Escaneá para ver la reserva', rightX, doc.y + 92, {width: 110, align: 'center'})
          .fillColor(PALETTE.text);
      } catch {
      }
    }

    // Empresa
    const compY = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(PALETTE.text);
    doc.text(COMPANY_NAME, doc.page.margins.left, compY);
    doc.text(COMPANY_RUC);
    doc.text(COMPANY_ADDRESS);
    doc.text(`Tel: ${COMPANY_PHONE} · ${COMPANY_EMAIL}`);
    if (COMPANY_WEBSITE) doc.text(COMPANY_WEBSITE);
    doc.moveDown();
    hr();

    // ---- Cards (ahora visibles) ----
    renderInfoCard('Datos de la Reserva', [
      `Nº de Reserva: ${String(reservationId ?? '—')}`,
      `Estado: ${formatReservationStatus(reservationStatus)}`,
      `Período: ${fmtDateTime(startAt)} a ${fmtDateTime(endAt)}`,
      `Total del Contrato: ${fmtCurrency(totalAmount || subtotal)}`,
      ...(note ? [`Notas: ${String(note)}`] : []),
    ]);

    renderInfoCard('Datos del Cliente', [
      `Cliente: ${fullName}`,
      `Documento: ${String(documentNumber)}`,
      ...(phone ? [`Teléfono: ${String(phone)}`] : []),
      ...(email ? [`Email: ${String(email)}`] : []),
    ]);

    // ---- Tabla ----
    doc.font('Helvetica-Bold').fontSize(12).fillColor(PALETTE.text).text('Vehículos incluidos');
    doc.moveDown(0.4);

    drawTable({
      headers: ['ID', 'Modelo', 'Patente', 'Año', 'Importe'],
      colWidths: [55, 200, 90, 60, 90],
      aligns: ['left', 'left', 'left', 'center', 'right'],
      rows: (items.length ? items : [{
        vehicle_id: '—', model: '—', license_plate: '—', year: '—', line_amount: 0
      }]).map(it => ([
        it.vehicle_id,
        it.model ? `${it.brand_name ? it.brand_name + ' ' : ''}${it.model}` : '(sin detalle)',
        it.license_plate,
        it.year,
        fmtCurrency(it.line_amount),
      ])),
    });

    doc.moveDown(0.5);

    // ---- Resumen económico ----
    const bx = doc.page.margins.left;
    const bw = 260;
    const by = doc.y;
    roundedRect(bx, by, bw, 60, 8, '#fff', PALETTE.border);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PALETTE.text).text('Resumen económico', bx + 10, by + 8);
    doc.font('Helvetica').fontSize(10).fillColor(PALETTE.text)
      .text(`Subtotal: ${fmtCurrency(subtotal)}`, bx + 10, by + 28)
      .text(`Total: ${fmtCurrency(totalAmount || subtotal)}`, bx + 10, by + 44);

    doc.moveDown(2);

    // ---- TyC ----
    doc.font('Helvetica-Bold').fontSize(12).fillColor(PALETTE.text).text('Términos y Condiciones');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor(PALETTE.text).list([
      'Requisitos del conductor: El arrendatario declara ser mayor de 18 años y poseer licencia vigente.',
      'Uso del vehículo: Conforme a ley y manual. Prohibido carreras, remolques no autorizados, cargas peligrosas o subarriendo.',
      'Conductores adicionales: Solo personas registradas y autorizadas por la empresa.',
      'Kilometraje y combustible: Devolución con el mismo nivel indicado; se cobrará reposición si corresponde.',
      'Mantenimiento y averías: Verificar niveles básicos; ante alertas, detener uso y contactar a la empresa.',
      'Accidentes y siniestros: Aviso inmediato, parte policial y cooperación con aseguradora.',
      'Multas, peajes y sanciones: A cargo del arrendatario; se podrán debitar del medio de pago registrado.',
      'Seguro y deducible: Cobertura según póliza; deducible y exclusiones a cargo del arrendatario.',
      'Daños, pérdidas y limpieza: Se cobrará por daños, faltantes y limpieza extraordinaria.',
      'Retrasos en la devolución: Cargo por hora o día adicional según tarifas vigentes.',
      'Devolución anticipada/cancelaciones: Sujetos a la política vigente.',
      'Acta de entrega y devolución: Forma parte integrante del contrato.',
      'Fronteras: Prohibido salir del país sin autorización escrita.',
      'Rastreo y telemetría: Puede incluirse por seguridad y cumplimiento.',
      'Pago y garantía: Autorización de cargos por alquiler, depósito, deducible, multas y reposiciones.',
      'Incumplimiento: Habilita retiro del vehículo y reclamo de daños.',
      'Jurisdicción y ley aplicable: La del país de la sede de la empresa.',
      'Datos personales: Tratamiento conforme a la política de privacidad publicada.',
      'Vigencia: Desde la firma y durante el período de alquiler.',
    ], {bulletRadius: 1.6});

    // doc.moveDown(0.5);
    // doc.fontSize(8).fillColor(PALETTE.textMuted)
    //   .text('Este documento es un modelo estándar y puede requerir adecuaciones legales específicas para su negocio.');
    // doc.fillColor(PALETTE.text);
    // hr();

    // ---- Firmas ----
    const wPage = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colW = (wPage / 2) - 16;
    const xL = doc.page.margins.left;
    const xR = xL + colW + 32;
    const ySig = doc.y + 42;

    const subtitleClient = `${fullName}${documentNumber && documentNumber !== '—' ? ` · Doc: ${documentNumber}` : ''}`;
    drawSignature(xL, ySig, colW, 'Firma del Cliente', subtitleClient);
    drawSignature(xR, ySig, colW, 'Firma y Sello de la Empresa', `${COMPANY_NAME} · ${COMPANY_RUC}`);
    //
    // doc.y = ySig + 54;
    //
    // // Footer
    // const range = doc.bufferedPageRange();
    // for (let i = range.start; i < range.start + range.count; i++) {
    //   doc.switchToPage(i);
    //   const y = doc.page.height - 34;
    //   const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    //   doc.fontSize(8).fillColor(PALETTE.textMuted);
    //   doc.text(`${COMPANY_NAME} · ${COMPANY_ADDRESS} · ${COMPANY_PHONE} · ${COMPANY_EMAIL}`, doc.page.margins.left, y, {
    //     width: w,
    //     align: 'center'
    //   });
    //   doc.text(`Página ${i + 1} de ${range.count}`, doc.page.margins.left, y + 10, {width: w, align: 'center'});
    // }
    doc.fillColor(PALETTE.text);

    doc.end();
  });
}
