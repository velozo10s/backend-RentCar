import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/** =========================
 * Helpers comunes (XLSX)
 * ========================= */

function addTableSheet(wb, name, columns, rows, { headerFill = 'FFEEEEEE', autoFilter = true } = {}) {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 20 }));
    if (rows?.length) ws.addRows(rows);

    // Estilos header
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFill } };
    header.alignment = { vertical: 'middle', horizontal: 'center' };
    header.height = 18;

    if (autoFilter) {
        ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length }
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
 * XLSX por tipo de reporte
 * ========================= */

function xlsxReservationStatus(payload) {
    const wb = new ExcelJS.Workbook();

    // 1) Summary by Status
    const summaryRows = Object.entries(payload.aggregates?.byStatus || {}).map(([status, count]) => ({ status, count }));
    addTableSheet(
        wb,
        'Summary by Status',
        [
            { header: 'Status', key: 'status', width: 24 },
            { header: 'Count', key: 'count', width: 12, alignment: { horizontal: 'right' } }
        ],
        summaryRows
    );

    // 2) Reservations (una fila por reserva)
    const reservations = (payload.groups || []).flatMap(g =>
        (g.reservations || []).map(r => ({
            id: r.id,
            status: r.status,
            customer_name: r.customer_name,
            start_at: r.start_at,
            end_at: r.end_at,
            total_amount: Number(r.total_amount),
            note: r.note || '',
            items_count: Array.isArray(r.items) ? r.items.length : 0
        }))
    );
    addTableSheet(
        wb,
        'Reservations',
        [
            { header: 'Reservation ID', key: 'id', width: 16 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Customer', key: 'customer_name', width: 28 },
            { header: 'Start', key: 'start_at', width: 22 },
            { header: 'End', key: 'end_at', width: 22 },
            { header: 'Total', key: 'total_amount', width: 14, numFmt: '#,##0.00', alignment: { horizontal: 'right' } },
            { header: 'Note', key: 'note', width: 40 },
            { header: 'Items', key: 'items_count', width: 10, alignment: { horizontal: 'right' } }
        ],
        reservations
    );

    // 3) Items (una fila por ítem)
    const items = (payload.groups || []).flatMap(g =>
        (g.reservations || []).flatMap(r =>
            (r.items || []).map(it => ({
                reservation_id: r.id,
                vehicle_id: it.vehicle_id,
                line_amount: Number(it.line_amount)
            }))
        )
    );
    addTableSheet(
        wb,
        'Items',
        [
            { header: 'Reservation ID', key: 'reservation_id', width: 16 },
            { header: 'Vehicle ID', key: 'vehicle_id', width: 14 },
            { header: 'Line Amount', key: 'line_amount', width: 16, numFmt: '#,##0.00', alignment: { horizontal: 'right' } }
        ],
        items
    );

    return wb;
}

function xlsxMonthlyRevenue(payload) {
    const wb = new ExcelJS.Workbook();

    // 1) Summary (serie mensual)
    const series = (payload.aggregates?.series || []).map(s => ({
        month: s.month,
        revenue: Number(s.revenue)
    }));
    addTableSheet(
        wb,
        'Monthly Summary',
        [
            { header: 'Month', key: 'month', width: 16 },
            { header: 'Revenue', key: 'revenue', width: 16, numFmt: '#,##0.00', alignment: { horizontal: 'right' } }
        ],
        series
    );

    // 2) Reservations by Month
    const rows = (payload.groups || []).flatMap(g =>
        (g.reservations || []).map(r => ({
            month: g.month,
            reservation_id: r.id,
            customer_user_id: r.customer_user_id,
            status: r.status,
            start_at: r.start_at,
            end_at: r.end_at,
            total_amount: Number(r.total_amount)
        }))
    );
    addTableSheet(
        wb,
        'Reservations by Month',
        [
            { header: 'Month', key: 'month', width: 16 },
            { header: 'Reservation ID', key: 'reservation_id', width: 16 },
            { header: 'Customer User ID', key: 'customer_user_id', width: 18 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Start', key: 'start_at', width: 22 },
            { header: 'End', key: 'end_at', width: 22 },
            { header: 'Total', key: 'total_amount', width: 14, numFmt: '#,##0.00', alignment: { horizontal: 'right' } }
        ],
        rows
    );

    return wb;
}

function xlsxUpcomingMaintenance(payload) {
    const wb = new ExcelJS.Workbook();

    // 1) Buckets summary
    const b = payload.aggregates?.buckets || {};
    addTableSheet(
        wb,
        'Summary',
        [
            { header: 'Bucket', key: 'bucket', width: 24 },
            { header: 'Count', key: 'count', width: 12, alignment: { horizontal: 'right' } }
        ],
        [
            { bucket: 'overdue (<=0km)', count: b.overdue || 0 },
            { bucket: '< 500km', count: b.lt_500 || 0 },
            { bucket: '500–1000km', count: b.gte_500_lt_1000 || 0 },
            { bucket: 'Total', count: payload.aggregates?.total || 0 }
        ]
    );

    // 2) Vehicles table
    addTableSheet(
        wb,
        'Vehicles',
        [
            { header: 'Vehicle ID', key: 'id', width: 12 },
            { header: 'Brand', key: 'brand', width: 18 },
            { header: 'Model', key: 'model', width: 18 },
            { header: 'Year', key: 'year', width: 10, alignment: { horizontal: 'right' } },
            { header: 'Plate', key: 'license_plate', width: 14 },
            { header: 'Mileage', key: 'mileage', width: 12, alignment: { horizontal: 'right' } },
            { header: 'Next Service', key: 'maintenance_mileage', width: 14, alignment: { horizontal: 'right' } },
            { header: 'Km Remaining', key: 'km_remaining', width: 14, alignment: { horizontal: 'right' } },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Active', key: 'is_active', width: 10 }
        ],
        payload.items || []
    );

    return wb;
}

function xlsxFrequentCustomers(payload) {
    const wb = new ExcelJS.Workbook();

    // 1) Customers summary
    const rows = (payload.items || []).map(r => ({
        user_id: r.user_id,
        customer_name: r.customer_name,
        document_number: r.document_number,
        reservation_count: Number(r.reservation_count)
    }));
    addTableSheet(
        wb,
        'Customers',
        [
            { header: 'User ID', key: 'user_id', width: 12 },
            { header: 'Customer', key: 'customer_name', width: 28 },
            { header: 'Document', key: 'document_number', width: 16 },
            { header: 'Reservations', key: 'reservation_count', width: 14, alignment: { horizontal: 'right' } }
        ],
        rows
    );

    // 2) Reservations detail
    const reservations = (payload.items || []).flatMap(r =>
        (r.reservations || []).map(rv => ({
            user_id: r.user_id,
            customer_name: r.customer_name,
            reservation_id: rv.id,
            start_at: rv.start_at,
            end_at: rv.end_at,
            total_amount: Number(rv.total_amount)
        }))
    );
    addTableSheet(
        wb,
        'Reservations',
        [
            { header: 'User ID', key: 'user_id', width: 12 },
            { header: 'Customer', key: 'customer_name', width: 28 },
            { header: 'Reservation ID', key: 'reservation_id', width: 16 },
            { header: 'Start', key: 'start_at', width: 22 },
            { header: 'End', key: 'end_at', width: 22 },
            { header: 'Total', key: 'total_amount', width: 14, numFmt: '#,##0.00', alignment: { horizontal: 'right' } }
        ],
        reservations
    );

    return wb;
}

/** API principal: ahora recibe nameBase para decidir layout */
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
            // Fallback genérico (similar al viejo) por compatibilidad
            wb = new ExcelJS.Workbook();
            addTableSheet(
                wb,
                'aggregates',
                [
                    { header: 'key', key: 'key', width: 30 },
                    { header: 'value', key: 'value', width: 60 }
                ],
                Object.entries(payload.aggregates || {}).map(([k, v]) => ({ key: k, value: typeof v === 'object' ? JSON.stringify(v) : v }))
            );

            if (payload.groups?.length) {
                addTableSheet(
                    wb,
                    'groups',
                    [
                        { header: 'group_key', key: 'group_key', width: 24 },
                        { header: 'count', key: 'count', width: 10 },
                        { header: 'payload', key: 'payload', width: 80 }
                    ],
                    payload.groups.map(g => ({
                        group_key: g.status || g.month || '',
                        count: g.count || '',
                        payload: JSON.stringify(g)
                    }))
                );
            }

            if (payload.items?.length) {
                const keys = Object.keys(payload.items[0] || {});
                const ws = wb.addWorksheet('items');
                ws.addRow(keys);
                for (const it of payload.items) ws.addRow(keys.map(k => typeof it[k] === 'object' ? JSON.stringify(it[k]) : it[k]));
            }
        }
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
}

/** =========================
 * PDF helpers (tabla simple)
 * ========================= */

function drawTable(doc, startX, startY, columns, rows, {
    rowHeight = 18,
    headerFill = '#eeeeee',
    padding = 4,
    zebra = true,
    maxY = 770
} = {}) {
    let y = startY;

    // Header
    doc.save();
    doc.rect(startX, y, columns.reduce((a, c) => a + c.width, 0), rowHeight).fill(headerFill).restore();
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    let x = startX;
    for (const col of columns) {
        doc.text(col.header, x + padding, y + 4, { width: col.width - padding * 2, ellipsis: true });
        x += col.width;
    }
    y += rowHeight;

    // Rows
    doc.font('Helvetica').fontSize(9);
    rows.forEach((r, idx) => {
        if (y + rowHeight > maxY) {
            doc.addPage();
            y = 40;
            // re-draw header in new page
            doc.save();
            doc.rect(startX, y, columns.reduce((a, c) => a + c.width, 0), rowHeight).fill(headerFill).restore();
            doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
            let hx = startX;
            for (const c of columns) {
                doc.text(c.header, hx + padding, y + 4, { width: c.width - padding * 2, ellipsis: true });
                hx += c.width;
            }
            y += rowHeight;
            doc.font('Helvetica').fontSize(9);
        }

        if (zebra && idx % 2 === 0) {
            doc.save();
            doc.rect(startX, y, columns.reduce((a, c) => a + c.width, 0), rowHeight).fill('#f9f9f9').restore();
        }

        let cx = startX;
        for (const col of columns) {
            const val = r[col.key] ?? '';
            doc.fillColor('#000');
            doc.text(String(val), cx + padding, y + 4, { width: col.width - padding * 2, ellipsis: true });
            cx += col.width;
        }
        y += rowHeight;
    });

    return y;
}

/** =========================
 * PDF por tipo de reporte
 * ========================= */

function pdfReservationStatus(doc, payload, title) {
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown(0.5);

    // Summary
    doc.fontSize(12).text('Summary by Status');
    const summary = Object.entries(payload.aggregates?.byStatus || {}).map(([status, count]) => ({ status, count }));
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'Status', key: 'status', width: 220 },
            { header: 'Count', key: 'count', width: 100 }
        ],
        summary
    );
    doc.moveDown(1);

    // Reservations
    doc.fontSize(12).text('Reservations');
    const reservations = (payload.groups || []).flatMap(g =>
        (g.reservations || []).map(r => ({
            id: r.id,
            status: r.status,
            customer: r.customer_name,
            start: r.start_at,
            end: r.end_at,
            total: Number(r.total_amount),
            items: Array.isArray(r.items) ? r.items.length : 0
        }))
    );
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'ID', key: 'id', width: 50 },
            { header: 'Status', key: 'status', width: 90 },
            { header: 'Customer', key: 'customer', width: 160 },
            { header: 'Start', key: 'start', width: 120 },
            { header: 'End', key: 'end', width: 120 },
            { header: 'Total', key: 'total', width: 70 },
            { header: 'Items', key: 'items', width: 50 }
        ],
        reservations
    );
}

function pdfMonthlyRevenue(doc, payload, title) {
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(12).text('Monthly Summary');
    const series = (payload.aggregates?.series || []).map(s => ({ month: s.month, revenue: Number(s.revenue) }));
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'Month', key: 'month', width: 220 },
            { header: 'Revenue', key: 'revenue', width: 120 }
        ],
        series
    );
    doc.moveDown(1);

    doc.fontSize(12).text('Reservations by Month');
    const rows = (payload.groups || []).flatMap(g =>
        (g.reservations || []).map(r => ({
            month: g.month,
            reservation_id: r.id,
            status: r.status,
            total: Number(r.total_amount)
        }))
    );
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'Month', key: 'month', width: 140 },
            { header: 'Reservation ID', key: 'reservation_id', width: 120 },
            { header: 'Status', key: 'status', width: 120 },
            { header: 'Total', key: 'total', width: 120 }
        ],
        rows
    );
}

function pdfUpcomingMaintenance(doc, payload, title) {
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(12).text('Summary');
    const b = payload.aggregates?.buckets || {};
    const summary = [
        { bucket: 'overdue (<=0km)', count: b.overdue || 0 },
        { bucket: '< 500km', count: b.lt_500 || 0 },
        { bucket: '500–1000km', count: b.gte_500_lt_1000 || 0 },
        { bucket: 'Total', count: payload.aggregates?.total || 0 }
    ];
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'Bucket', key: 'bucket', width: 220 },
            { header: 'Count', key: 'count', width: 100 }
        ],
        summary
    );
    doc.moveDown(1);

    doc.fontSize(12).text('Vehicles');
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'ID', key: 'id', width: 40 },
            { header: 'Brand', key: 'brand', width: 90 },
            { header: 'Model', key: 'model', width: 90 },
            { header: 'Year', key: 'year', width: 40 },
            { header: 'Plate', key: 'license_plate', width: 80 },
            { header: 'Mileage', key: 'mileage', width: 70 },
            { header: 'Next', key: 'maintenance_mileage', width: 70 },
            { header: 'Km Rem.', key: 'km_remaining', width: 70 },
            { header: 'Status', key: 'status', width: 80 },
            { header: 'Active', key: 'is_active', width: 50 }
        ],
        payload.items || []
    );
}

function pdfFrequentCustomers(doc, payload, title) {
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(12).text('Customers');
    const customers = (payload.items || []).map(r => ({
        user_id: r.user_id,
        customer_name: r.customer_name,
        document_number: r.document_number,
        reservation_count: Number(r.reservation_count)
    }));
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'User ID', key: 'user_id', width: 70 },
            { header: 'Customer', key: 'customer_name', width: 200 },
            { header: 'Document', key: 'document_number', width: 120 },
            { header: 'Reservations', key: 'reservation_count', width: 100 }
        ],
        customers
    );

    doc.addPage();
    doc.fontSize(12).text('Reservations');
    const reservations = (payload.items || []).flatMap(r =>
        (r.reservations || []).map(rv => ({
            user_id: r.user_id,
            reservation_id: rv.id,
            start: rv.start_at,
            end: rv.end_at,
            total: Number(rv.total_amount)
        }))
    );
    drawTable(
        doc, 40, doc.y + 6,
        [
            { header: 'User ID', key: 'user_id', width: 70 },
            { header: 'Reservation ID', key: 'reservation_id', width: 120 },
            { header: 'Start', key: 'start', width: 140 },
            { header: 'End', key: 'end', width: 140 },
            { header: 'Total', key: 'total', width: 100 }
        ],
        reservations
    );
}

/** API principal PDF: usa nameBase (title) para decidir layout de tabla */
export async function buildSimplePdfBuffer(payload, title = 'report') {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    return new Promise((resolve, reject) => {
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        switch (title) {
            case 'reservation_status':
                pdfReservationStatus(doc, payload, 'Reservation Status');
                break;
            case 'monthly_revenue':
                pdfMonthlyRevenue(doc, payload, 'Monthly Revenue');
                break;
            case 'upcoming_maintenance':
                pdfUpcomingMaintenance(doc, payload, 'Upcoming Maintenance');
                break;
            case 'frequent_customers':
                pdfFrequentCustomers(doc, payload, 'Frequent Customers');
                break;
            default:
                // Fallback simple si aparece otro reporte
                doc.fontSize(16).text(title, { underline: true });
                doc.moveDown(0.5);
                doc.fontSize(12).text('Data');
                drawTable(
                    doc, 40, doc.y + 6,
                    [{ header: 'JSON', key: 'json', width: 500 }],
                    [{ json: JSON.stringify(payload).slice(0, 4000) + '…' }]
                );
        }

        doc.end();
    });
}

/** Contrato PDF (se mantiene igual) */
export async function buildContractPdfBuffer(data) {
    const {
        COMPANY_NAME = 'Tu Empresa S.A.',
        COMPANY_RUC = 'RUC 0000000-0',
        COMPANY_ADDRESS = 'Dirección, Ciudad, País',
        COMPANY_PHONE = '+595 000 000 000',
        COMPANY_EMAIL = 'info@tuempresa.com',
        COMPANY_WEBSITE = 'https://tuempresa.com',
        COMPANY_LOGO_PATH, // opcional: ruta local a una imagen .png/.jpg
    } = process.env;

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];

    // Helpers
    const fmtCurrency = (n) =>
        new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(Number(n || 0));

    const fmtDateTime = (dt) => {
        // dt puede venir como string ISO o Date; mostramos fecha y hora local “es-PY”
        const d = new Date(dt);
        const fFecha = new Intl.DateTimeFormat('es-PY', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        const fHora = new Intl.DateTimeFormat('es-PY', { hour: '2-digit', minute: '2-digit' }).format(d);
        return `${fFecha} ${fHora}`;
    };

    const drawHr = (y = doc.y + 6) => {
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor('#CCCCCC').lineWidth(1).stroke().fillColor('black');
        doc.moveDown(0.3);
    };

    const addFooter = () => {
        const range = doc.bufferedPageRange(); // { start: 0, count: N }
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            const pageNum = i + 1;
            const total = range.count;
            const footerY = doc.page.height - 40;
            doc.fontSize(8).fillColor('#555');
            doc.text(`${COMPANY_NAME} · ${COMPANY_ADDRESS} · ${COMPANY_PHONE} · ${COMPANY_EMAIL}`, doc.page.margins.left, footerY, { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
            doc.text(`Página ${pageNum} de ${total}`, doc.page.margins.left, footerY + 12, { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
            doc.fillColor('black');
        }
    };

    // QR opcional
    const maybeDrawQR = async () => {
        if (!data?.reservation_url) return;
        try {
            const qrPng = await QRCode.toBuffer(data.reservation_url, { margin: 1, scale: 4 });
            doc.image(qrPng, doc.page.width - doc.page.margins.right - 90, 60, { width: 80 });
            doc.fontSize(8).fillColor('#555')
                .text('Escaneá para ver la reserva', doc.page.width - doc.page.margins.right - 90, 145, { width: 80, align: 'center' })
                .fillColor('black');
        } catch { /* silent */ }
    };

    return await new Promise(async (resolve, reject) => {
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // ENCABEZADO
        if (COMPANY_LOGO_PATH) {
            try {
                doc.image(COMPANY_LOGO_PATH, doc.page.margins.left, 40, { width: 120 });
            } catch { /* si falla el logo, seguimos sin cortar */ }
        }

        doc.font('Helvetica-Bold').fontSize(18).text('CONTRATO DE ALQUILER DE VEHÍCULO', 0, 40, {
            align: 'right'
        });

        doc.moveDown(1.8);
        drawHr();

        // INFO EMPRESA
        doc.fontSize(10).font('Helvetica');
        doc.text(`${COMPANY_NAME}`, { continued: false });
        doc.text(`${COMPANY_RUC}`);
        doc.text(`${COMPANY_ADDRESS}`);
        doc.text(`Tel: ${COMPANY_PHONE} · Email: ${COMPANY_EMAIL}`);
        if (COMPANY_WEBSITE) doc.text(`${COMPANY_WEBSITE}`);
        doc.moveDown(0.5);

        await maybeDrawQR();

        drawHr();

        // DATOS DE LA RESERVA Y CLIENTE
        const label = (t) => doc.font('Helvetica-Bold').text(t, { continued: true }).font('Helvetica');

        doc.fontSize(12);
        label('Nº de Reserva: '); doc.text(`${data.id}`);
        label('Estado: '); doc.text(`${data.status}`);
        label('Período: '); doc.text(`${fmtDateTime(data.start_at)} a ${fmtDateTime(data.end_at)}`);
        label('Total del Contrato: '); doc.text(`${fmtCurrency(data.total_amount)}`);
        if (data.note) { label('Notas: '); doc.text(`${data.note}`); }
        doc.moveDown(0.5);

        label('Cliente: '); doc.text(`${data.first_name} ${data.last_name}`);
        label('Documento: '); doc.text(`${data.document_number}`);
        drawHr();

        // TABLA DE VEHÍCULOS
        doc.font('Helvetica-Bold').fontSize(12).text('Vehículos incluidos', { align: 'left' });
        doc.moveDown(0.3);

        const table = {
            x: doc.page.margins.left,
            y: doc.y,
            colWidths: [55, 165, 80, 80, 90], // ID, Modelo, Patente, Año, Importe
            headers: ['ID', 'Modelo', 'Patente', 'Año', 'Importe'],
        };

        const drawRow = (cells, bold = false) => {
            const y = doc.y;
            const fonts = bold ? 'Helvetica-Bold' : 'Helvetica';
            doc.font(fonts).fontSize(10);
            let x = table.x;
            for (let i = 0; i < cells.length; i++) {
                const w = table.colWidths[i];
                doc.text(String(cells[i] ?? ''), x + 2, y, { width: w - 4, continued: false });
                x += w;
            }
            doc.moveDown(0.6);
            // salto de página si hace falta
            if (doc.y > doc.page.height - 120) doc.addPage();
        };

        // Header
        drawRow(table.headers, true);
        drawHr();

        // Body
        const items = Array.isArray(data.items) ? data.items : [];
        items.forEach((it) => {
            drawRow([
                it.vehicle_id ?? '',
                it.model ? `${it.brand_name ?? ''} ${it.model}`.trim() : '(sin detalle)',
                it.license_plate ?? '—',
                it.year ?? '—',
                fmtCurrency(it.line_amount),
            ]);
        });

        drawHr();

        // Resumen económico
        doc.font('Helvetica-Bold').fontSize(11).text('Resumen económico', { align: 'left' });
        doc.moveDown(0.2);
        doc.font('Helvetica').fontSize(10);
        doc.text(`Subtotal: ${fmtCurrency(items.reduce((a, b) => a + Number(b.line_amount || 0), 0))}`);
        // acá podrías sumar: seguro, depósito, descuentos, impuestos, etc.
        doc.text(`Total: ${fmtCurrency(data.total_amount)}`);
        drawHr();

        // TÉRMINOS Y CONDICIONES
        doc.font('Helvetica-Bold').fontSize(12).text('Términos y Condiciones', { align: 'left' });
        doc.moveDown(0.2);
        doc.font('Helvetica').fontSize(9).list([
            'Requisitos del conductor: El arrendatario declara ser mayor de 18 años, poseer licencia de conducir vigente y válida en el territorio, y presentar documento de identidad.',
            'Uso del vehículo: El vehículo debe utilizarse conforme a la ley y al manual del fabricante. Queda prohibido su uso para carreras, remolques no autorizados, transporte de carga peligrosa o subarriendo.',
            'Conductores adicionales: Solo podrán conducir las personas registradas y autorizadas por la empresa. El arrendatario responde por su conducta.',
            'Kilometraje y combustible: El vehículo se entrega con odómetro funcional y nivel de combustible indicado en el acta de entrega. La devolución deberá realizarse con el mismo nivel; de lo contrario, se cobrará la reposición más un cargo de servicio.',
            'Mantenimiento y averías: El arrendatario debe verificar periódicamente niveles básicos (aceite, refrigerante, presión de neumáticos). Ante luces de advertencia o ruidos anormales, debe detener el uso y contactar a la empresa.',
            'Accidentes y siniestros: En caso de incidente, el arrendatario debe dar aviso inmediato a la empresa y a las autoridades, completar el parte policial y cooperar con la aseguradora. No debe aceptar responsabilidades ni acuerdos sin autorización.',
            'Multas, peajes y sanciones: Son a cargo del arrendatario durante el período de alquiler, aun si se notifican con posterioridad. La empresa podrá cargar estos importes y gastos administrativos al medio de pago registrado.',
            'Seguro y deducible: El vehículo cuenta con cobertura de seguro conforme a la póliza vigente. El arrendatario será responsable del deducible, exclusiones y cualquier daño no cubierto por la póliza o por uso indebido.',
            'Daños, pérdidas y limpieza: Se cobrará por daños, faltantes de accesorios, limpieza extraordinaria (incluye olores fuertes, barro excesivo, mascotas sin protección) y/o desinfección si corresponde.',
            'Retrasos en la devolución: Se aplicará cargo por hora o día adicional según tarifas vigentes si se excede el horario pactado. Retrasos mayores a 2 horas pueden computarse como día adicional completo.',
            'Devolución anticipada y cancelaciones: La devolución anticipada no garantiza reembolso por días no utilizados. Las cancelaciones/no-show se regirán por la política vigente al momento de la reserva.',
            'Acta de entrega y devolución: Las condiciones estéticas, nivel de combustible, km y accesorios se documentarán en el formulario/acta, que forma parte integrante de este contrato.',
            'Manejo en fronteras: Salir del país sin autorización escrita de la empresa está prohibido y anula la cobertura del seguro.',
            'Rastreo y telemetría: El vehículo puede contar con GPS/telemetría para seguridad y cumplimiento. El arrendatario lo consiente y autoriza su uso.',
            'Pago y garantía: El arrendatario autoriza a la empresa a realizar cargos en la tarjeta/medio de pago provisto por el alquiler, depósito de garantía, deducible del seguro, multas, peajes, reposiciones y otros cargos derivados del contrato.',
            'Incumplimiento: El uso ilícito, falsedad de datos, o mora en el pago habilita a la empresa a retirar el vehículo sin previo aviso y a reclamar daños y perjuicios.',
            'Jurisdicción y ley aplicable: Este contrato se rige por las leyes del país de la sede de la empresa. Cualquier controversia se somete a los tribunales competentes de dicha jurisdicción.',
            'Datos personales: El arrendatario autoriza el tratamiento de sus datos conforme a la política de privacidad disponible en el sitio web de la empresa.',
            'Vigencia: Este contrato entra en vigor con la firma de las partes y rige durante el período de alquiler indicado.',
        ], { bulletRadius: 1.5 });

        doc.moveDown(0.5);
        doc.fontSize(8).fillColor('#666').text('Este documento es un modelo estándar y puede requerir adecuaciones legales específicas para su negocio.', { align: 'left' }).fillColor('black');

        drawHr();

        // FIRMAS
        doc.moveDown(1);
        const sigY = doc.y + 40;
        const colW = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;

        // Cliente
        doc.moveTo(doc.page.margins.left + 10, sigY).lineTo(doc.page.margins.left + colW - 10, sigY).strokeColor('#000').lineWidth(1).stroke().fillColor('black');
        doc.fontSize(10).text('Firma del Cliente', doc.page.margins.left + 10, sigY + 5, { width: colW - 20, align: 'center' });
        doc.fontSize(9).text(`${data.first_name} ${data.last_name} · Doc: ${data.document_number}`, { width: colW - 20, align: 'center' });

        // Empresa
        const rightX = doc.page.margins.left + colW + 10;
        doc.moveTo(rightX, sigY).lineTo(doc.page.width - doc.page.margins.right - 10, sigY).stroke();
        doc.fontSize(10).text('Firma y Sello de la Empresa', rightX, sigY + 5, { width: colW - 20, align: 'center' });
        doc.fontSize(9).text(`${COMPANY_NAME} · ${COMPANY_RUC}`, rightX, undefined, { width: colW - 20, align: 'center' });

        // Cierre
        addFooter();
        doc.end();
    });
}