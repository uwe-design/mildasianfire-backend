// server.js
import express from 'express';
import { pool } from './db.js';
//import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';

const app = express();
const PORT = process.env.PORT || 3000;

// SendGrid API Key setzen (für Dynamic Template)
if (!process.env.SENDGRID_API_KEY) {
  console.warn('WARNUNG: SENDGRID_API_KEY ist nicht gesetzt – Kunden-Mail per Template ist deaktiviert.');
} else {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// --- CORS erlauben (für dein Browser-Frontend/Admin) ---
app.use((req, res, next) => {
  // Für den Anfang: alles erlauben
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    // Preflight-Anfrage direkt beantworten
    return res.sendStatus(200);
  }
  next();
});

// JSON-Body erlauben
app.use(express.json());

function toCents(amount) {
  if (typeof amount !== 'number') return 0;
  return Math.round(amount * 100);
}

// ---------------------------------------------
// Nodemailer-Transporter (für Shop-Owner-Mail)
// ---------------------------------------------
let mailTransporter = null;

function getTransporter() {
  if (mailTransporter) return mailTransporter;

  const { SENDGRID_API_KEY } = process.env;

  if (!SENDGRID_API_KEY) {
    console.warn('Mailversand für Shop-Owner nicht konfiguriert (SENDGRID_API_KEY fehlt).');
    return null;
  }

  mailTransporter = nodemailer.createTransport({
    service: 'SendGrid',
    auth: {
      user: 'apikey',
      pass: SENDGRID_API_KEY
    }
  });

  return mailTransporter;
}

// ---------------------------------------------
// Email-Helfer: Bestellbestätigung
// - Kunde: SendGrid Dynamic Template (sgMail)
// - Shop-Owner: Text-Mail via Nodemailer
// ---------------------------------------------
async function sendOrderEmails({ orderNumber, orderId, orderDate, customer, items, totals }) {
  const from = process.env.SMTP_FROM || 'MildAsianFire <shop@mildasianfire.de>';
  const shopOwnerEmail = process.env.SHOP_OWNER_EMAIL || from;

  // ---------------------------------
  // Hilfsfunktionen nur für diese Mail
  // ---------------------------------
  function formatCurrency(amount) {
    if (typeof amount !== 'number') {
      amount = Number(amount) || 0;
    }
    return amount.toLocaleString('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2
    });
  }

  function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  const mailPromises = [];

  // ---------------------------------------------
  // 1) Kunden-Mail via SendGrid Dynamic Template
  // ---------------------------------------------
if (customer.email && process.env.SENDGRID_TEMPLATE_ID && process.env.SENDGRID_API_KEY) {

  const orderItemsForTemplate = items.map(it => ({
    sku: it.sku,
    name: it.name,
    quantity: it.qty,
    price: formatCurrency(it.price),
    total: formatCurrency((it.price || 0) * it.qty)
  }));

  const dynamicData = {
    first_name: customer.firstName,
    last_name: customer.lastName,
    email: customer.email,
    phone: customer.phone,
    street: customer.street,
    house_number: customer.house,
    zip_code: customer.zip,
    city: customer.city,

    order_number: orderNumber,
    order_date: formatDate(orderDate || new Date()),
    order_status: 'NEW',

    order_subtotal: formatCurrency(totals.subtotal),
    order_shipping: formatCurrency(totals.shipping),
    order_total: formatCurrency(totals.total),

    payment_method: 'OFFLINE',

    order_items: orderItemsForTemplate,

    link_terms: 'https://mildasianfire.de/index_agb.html',
    link_imprint: 'https://mildasianfire.de/index_impressum.html',
    link_privacy: 'https://mildasianfire.de/index_datenschutz.html',
    link_instagram: 'https://instagram.com/',
    link_youtube: 'https://youtube.com/',
    link_pinterest: 'https://pinterest.com/',
    year: new Date().getFullYear(),
    support_email: process.env.SHOP_OWNER_EMAIL || 'support@mildasianfire.de'
  };

  const subjectLine = `Deine MildAsianFire Bestellung #${orderNumber}`;
  console.log('Mail Subject:', subjectLine);

  mailPromises.push(
    sgMail.send({
      to: customer.email,
      from,
      templateId: process.env.SENDGRID_TEMPLATE_ID,
      subject: subjectLine,                // <- WICHTIG
      dynamic_template_data: dynamicData
    })
  );

} else {
  console.warn('Kunden-Mail nicht gesendet (keine Email oder kein SENDGRID_TEMPLATE_ID/SENDGRID_API_KEY).');
}
  // -------------------------------------------------------
  // 2) Optionale Text-Mail an Shop-Betreiber via Nodemailer
  // -------------------------------------------------------
//  const transporter = getTransporter();
//  if (transporter && shopOwnerEmail) {
//    const itemLines = items.map(it =>
//      `- ${it.qty}× ${it.name} (SKU: ${it.sku}) – ${(it.price || 0).toFixed(2).replace('.', ',')} €`
//    ).join('\n');

//    const subtotalText = (totals.subtotal || 0).toFixed(2).replace('.', ',') + ' €';
//    const shippingText = (totals.shipping || 0).toFixed(2).replace('.', ',') + ' €';
//    const totalText    = (totals.total || 0).toFixed(2).replace('.', ',') + ' €';

//    const addressLines = [
//      `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
//      `${customer.street || ''} ${customer.house || ''}`.trim(),
//      `${customer.zip || ''} ${customer.city || ''}`.trim()
//    ].filter(Boolean).join('\n');

//    const subjectOwner = `Neue Bestellung #${orderNumber} – MildAsianFire`;

//    const textBodyOwner = `
//Neue Bestellung bei MildAsianFire:

//Bestellnummer: ${orderNumber}
//Interne ID: ${orderId}

//Kunde:
//${addressLines || '-'}
//E-Mail: ${customer.email || '-'}

//Artikel:
//${itemLines || '-'}

//Zwischensumme: ${subtotalText}
//Versand:       ${shippingText}
//Gesamt:        ${totalText}
//    `.trim();

//    mailPromises.push(
//      transporter.sendMail({
//        from,
//        to: shopOwnerEmail,
//        subject: subjectOwner,
//        text: textBodyOwner
//      })
//    );
//  } else {
//    console.warn('Shop-Owner-Mail nicht gesendet (kein Transporter oder keine SHOP_OWNER_EMAIL).');
//  }

  // ---------------------------------
  // Mails wirklich senden
  // ---------------------------------
  try {
    if (mailPromises.length > 0) {
      await Promise.all(mailPromises);
      console.log('Bestellbestätigungs-Mails erfolgreich gesendet für Order', orderNumber);
    } else {
      console.warn('sendOrderEmails: Keine Mails zu senden.');
    }
	
//  } catch (err) {
//    console.error('Fehler beim Senden der Bestellbestätigungs-Mail:', err);
    // Bestellung bleibt gültig – Fehler wird nur geloggt
//  }
  
} catch (err) {
  console.error('Fehler beim Senden der Bestellbestätigungs-Mail:', err);

  if (err.response && err.response.body && err.response.body.errors) {
    console.error('SendGrid-Fehlerdetails:', JSON.stringify(err.response.body.errors, null, 2));
  }
  // Bestellung bleibt gültig – Fehler wird nur geloggt
} 
  
  
}

// ---------------------------------------------
// Helper: Ordernummer im Backend generieren: YY-MM-DD-XXXX
// ---------------------------------------------
async function generateOrderNumber(client) {
  // Nächster Wert aus der Sequence
  const seqRes = await client.query(`SELECT nextval('order_number_seq') AS seq`);
  const seq = seqRes.rows[0].seq; // 1, 2, 3, ...

  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const padded = String(seq).padStart(4, '0');

  return `${yy}-${mm}-${dd}-${padded}`;
}

// ---------------------------------------------
// POST /orders – Bestellung speichern + Lagerbestand prüfen/aktualisieren + Mails
// ---------------------------------------------
app.post('/orders', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    console.error('POST /orders: DATABASE_URL ist nicht gesetzt.');
    return res.status(500).json({ error: 'Server-Konfiguration fehlerhaft (DATABASE_URL fehlt).' });
  }

  const order = req.body;

  if (!order || !order.customer || !Array.isArray(order.items) || order.items.length === 0) {
    return res.status(400).json({ error: 'Ungültige Bestellung' });
  }

  const client = await pool.connect().catch(err => {
    console.error('Konnte keine DB-Verbindung herstellen:', err);
    return null;
  });

  if (!client) {
    return res.status(500).json({ error: 'Datenbank nicht erreichbar.' });
  }

  try {
    await client.query('BEGIN');

    const {
      firstName,
      lastName,
      email,
      phone,
      street,
      house,
      zip,
      city
    } = order.customer;

    // 1. Kunden anlegen oder wiederverwenden
    let customerId;
    const existingCustomer = await client.query(
      `SELECT id FROM customers WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );

    if (existingCustomer.rows.length > 0) {
      customerId = existingCustomer.rows[0].id;
    } else {
      const insertCustomer = await client.query(
        `
        INSERT INTO customers (
          email, first_name, last_name, phone,
          street, house_number, zip_code, city
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
        `,
        [email, firstName, lastName, phone, street, house, zip, city]
      );
      customerId = insertCustomer.rows[0].id;
    }

    // 2. Bestellkopf
    const subtotalCents = toCents(order.subtotal);
    const shippingCents = toCents(order.shipping);
    const totalCents    = toCents(order.total);

    // Ordernummer im Backend generieren
    const orderNumber = await generateOrderNumber(client);

    const insertOrder = await client.query(
      `
      INSERT INTO orders (
        order_number,
        customer_id,
        status,
        subtotal_cents,
        shipping_cents,
        total_cents,
        payment_method,
        payment_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, created_at
      `,
      [
        orderNumber,
        customerId,
        'NEW',
        subtotalCents,
        shippingCents,
        totalCents,
        order.paymentMethod || 'UNKNOWN',
        'OPEN'
      ]
    );

    const orderId = insertOrder.rows[0].id;
    const orderCreatedAt = insertOrder.rows[0].created_at;

    // 3. Positionen + Lagerbestand prüfen/aktualisieren
    const itemsForMail = [];

    for (const item of order.items) {
      const { sku, name, qty, price } = item;

      if (!sku || !name || !qty || !price) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ungültige Position in Bestellung (SKU/Name/Menge/Preis fehlt).' });
      }

      // Produkt mit FOR UPDATE holen → schützt vor Race Conditions
      const productRes = await client.query(
        `
        SELECT id, stock_qty
        FROM products
        WHERE sku = $1
        FOR UPDATE
        `,
        [sku]
      );

      if (productRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Produkt mit SKU ${sku} nicht gefunden` });
      }

      const productRow   = productRes.rows[0];
      const productId    = productRow.id;
      const currentStock = productRow.stock_qty ?? 0;

      // Lager prüfen
      if (currentStock < qty) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Nicht genügend Lagerbestand für ${name} (SKU ${sku}). Verfügbar: ${currentStock}, angefragt: ${qty}.`
        });
      }

      // Lagerbestand reduzieren
      const newStock = currentStock - qty;
      await client.query(
        `
        UPDATE products
        SET stock_qty = $1
        WHERE id = $2
        `,
        [newStock, productId]
      );

      // Bestellposition speichern
      const unitPriceCents = toCents(price);
      const lineTotalCents = toCents(price * qty);

      await client.query(
        `
        INSERT INTO order_items (
          order_id,
          product_id,
          sku,
          name,
          qty,
          unit_price_cents,
          line_total_cents
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          orderId,
          productId,
          sku,
          name,
          qty,
          unitPriceCents,
          lineTotalCents
        ]
      );

      itemsForMail.push({ sku, name, qty, price });
    }

    await client.query('COMMIT');

    // Antwort an Frontend
    res.status(201).json({
      success: true,
      orderId,
      orderNumber
    });

    // Bestätigungsmails asynchron (Fehler brechen Bestellung NICHT ab)
    sendOrderEmails({
      orderNumber,
      orderId,
      orderDate: orderCreatedAt,
      customer: {
        firstName,
        lastName,
        email,
        phone,
        street,
        house,
        zip,
        city
      },
      items: itemsForMail,
      totals: {
        subtotal: order.subtotal,
        shipping: order.shipping,
        total: order.total
      }
    }).catch(err => {
      console.error('Fehler im sendOrderEmails-Aufruf:', err);
    });

  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback-Fehler:', rollbackErr);
    }

    console.error('Fehler beim Speichern der Bestellung:', err);

    if (err.code === '23505') {
      // unique_violation (z.B. order_number doppelt)
      return res.status(409).json({ error: 'Ordernummer bereits vergeben' });
    }

    res.status(500).json({ error: 'Fehler beim Speichern der Bestellung' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------
// GET /products – Produkte + Lagerbestand (für Admin)
// Optional: ?search=... (SKU oder Name enthält)
// ---------------------------------------------
app.get('/products', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    console.error('GET /products: DATABASE_URL ist nicht gesetzt.');
    return res.status(500).json({ error: 'Server-Konfiguration fehlerhaft (DATABASE_URL fehlt).' });
  }

  const search = (req.query.search || '').trim();

  const client = await pool.connect().catch(err => {
    console.error('Konnte keine DB-Verbindung herstellen:', err);
    return null;
  });

  if (!client) {
    return res.status(500).json({ error: 'Datenbank nicht erreichbar.' });
  }

  try {
    let result;
    if (search) {
      const like = `%${search.toLowerCase()}%`;
      result = await client.query(
        `
        SELECT id, sku, name, stock_qty
        FROM products
        WHERE LOWER(sku) LIKE $1
           OR LOWER(name) LIKE $1
        ORDER BY sku ASC
        LIMIT 200
        `,
        [like]
      );
    } else {
      result = await client.query(
        `
        SELECT id, sku, name, stock_qty
        FROM products
        ORDER BY sku ASC
        LIMIT 200
        `
      );
    }

    const products = result.rows.map(row => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      stockQty: row.stock_qty
    }));

    res.json({ products });

  } catch (err) {
    console.error('Fehler beim Laden der Produkte:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Produkte' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------
// POST /products/:id/stock – Lagerbestand setzen
// Body: { stockQty: number } – absoluter Wert
// ---------------------------------------------
app.post('/products/:id/stock', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    console.error('POST /products/:id/stock: DATABASE_URL ist nicht gesetzt.');
    return res.status(500).json({ error: 'Server-Konfiguration fehlerhaft (DATABASE_URL fehlt).' });
  }

  const productId = parseInt(req.params.id, 10);
  if (Number.isNaN(productId)) {
    return res.status(400).json({ error: 'Ungültige Produkt-ID' });
  }

  const { stockQty } = req.body;
  const parsedStock = Number(stockQty);

  if (!Number.isFinite(parsedStock) || parsedStock < 0) {
    return res.status(400).json({ error: 'Ungültiger Lagerbestand (muss eine Zahl >= 0 sein).' });
  }

  const client = await pool.connect().catch(err => {
    console.error('Konnte keine DB-Verbindung herstellen:', err);
    return null;
  });

  if (!client) {
    return res.status(500).json({ error: 'Datenbank nicht erreichbar.' });
  }

  try {
    const result = await client.query(
      `
      UPDATE products
      SET stock_qty = $1
      WHERE id = $2
      RETURNING id, sku, name, stock_qty
      `,
      [parsedStock, productId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produkt nicht gefunden' });
    }

    const row = result.rows[0];

    res.json({
      success: true,
      product: {
        id: row.id,
        sku: row.sku,
        name: row.name,
        stockQty: row.stock_qty
      }
    });

  } catch (err) {
    console.error('Fehler beim Aktualisieren des Lagerbestands:', err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Lagerbestands' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------
// GET /orders – Liste der Bestellungen (für Admin)
// ---------------------------------------------
app.get('/orders', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    console.error('GET /orders: DATABASE_URL ist nicht gesetzt.');
    return res.status(500).json({ error: 'Server-Konfiguration fehlerhaft (DATABASE_URL fehlt).' });
  }

  const client = await pool.connect().catch(err => {
    console.error('Konnte keine DB-Verbindung herstellen:', err);
    return null;
  });

  if (!client) {
    return res.status(500).json({ error: 'Datenbank nicht erreichbar.' });
  }

  try {
    // einfache Liste, neueste zuerst
    const result = await client.query(
      `
      SELECT
        o.id,
        o.order_number,
        o.created_at,
        o.status,
        o.total_cents,
        o.payment_status,
        c.first_name,
        c.last_name,
        c.email
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      ORDER BY o.created_at DESC
      LIMIT 200
      `
    );

    const orders = result.rows.map(row => ({
      id: row.id,
      orderNumber: row.order_number,
      createdAt: row.created_at,
      status: row.status,
      totalCents: row.total_cents,
      paymentStatus: row.payment_status,
      customer: {
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email
      }
    }));

    res.json({ orders });

  } catch (err) {
    console.error('Fehler beim Laden der Bestellungen:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Bestellungen' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------
// GET /orders/:id – Bestelldetails (Kopf + Kunde + Positionen)
// ---------------------------------------------
app.get('/orders/:id', async (req, res) => {
  if (!process.env.DATABASE_URL) {
    console.error('GET /orders/:id: DATABASE_URL ist nicht gesetzt.');
    return res.status(500).json({ error: 'Server-Konfiguration fehlerhaft (DATABASE_URL fehlt).' });
  }

  const orderId = parseInt(req.params.id, 10);
  if (Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'Ungültige Order-ID' });
  }

  const client = await pool.connect().catch(err => {
    console.error('Konnte keine DB-Verbindung herstellen:', err);
    return null;
  });

  if (!client) {
    return res.status(500).json({ error: 'Datenbank nicht erreichbar.' });
  }

  try {
    // Kopf + Kunde
    const orderRes = await client.query(
      `
      SELECT
        o.id,
        o.order_number,
        o.created_at,
        o.status,
        o.subtotal_cents,
        o.shipping_cents,
        o.total_cents,
        o.payment_method,
        o.payment_status,
        c.first_name,
        c.last_name,
        c.email,
        c.phone,
        c.street,
        c.house_number,
        c.zip_code,
        c.city,
        c.country
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1
      LIMIT 1
      `,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Bestellung nicht gefunden' });
    }

    const row = orderRes.rows[0];

    const order = {
      id: row.id,
      orderNumber: row.order_number,
      createdAt: row.created_at,
      status: row.status,
      subtotalCents: row.subtotal_cents,
      shippingCents: row.shipping_cents,
      totalCents: row.total_cents,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status
    };

    const customer = {
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      street: row.street,
      houseNumber: row.house_number,
      zip: row.zip_code,
      city: row.city,
      country: row.country
    };

    // Positionen
    const itemsRes = await client.query(
      `
      SELECT
        id,
        sku,
        name,
        qty,
        unit_price_cents,
        line_total_cents
      FROM order_items
      WHERE order_id = $1
      ORDER BY id ASC
      `,
      [orderId]
    );

    const items = itemsRes.rows.map(r => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      qty: r.qty,
      unitPriceCents: r.unit_price_cents,
      lineTotalCents: r.line_total_cents
    }));

    res.json({ order, customer, items });

  } catch (err) {
    console.error('Fehler beim Laden der Bestelldetails:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Bestelldetails' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------
// PATCH /orders/:id/status – Bestellstatus ändern
// Body: { status: "DONE" }
// ---------------------------------------------
app.patch('/orders/:id/status', async (req, res) => {
  const orderId = Number(req.params.id);
  const newStatus = (req.body?.status || '').trim().toUpperCase();

  if (!orderId || Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'Ungültige Order-ID' });
  }

  // Nur erlaubte Status
  const allowed = ['NEW', 'DONE'];
  if (!allowed.includes(newStatus)) {
    return res.status(400).json({
      error: `Ungültiger Status. Erlaubt: ${allowed.join(', ')}`
    });
  }

  const client = await pool.connect().catch((err) => {
    console.error('PATCH /orders/:id/status – DB Fehler:', err);
    return null;
  });

  if (!client) {
    return res.status(500).json({ error: 'Datenbank nicht erreichbar.' });
  }

  try {
    const update = await client.query(
      `
      UPDATE orders
      SET status = $1
      WHERE id = $2
      RETURNING id, order_number, status
      `,
      [newStatus, orderId]
    );

    if (update.rows.length === 0) {
      return res.status(404).json({ error: 'Bestellung nicht gefunden' });
    }

    const row = update.rows[0];

    res.json({
      success: true,
      id: row.id,
      orderNumber: row.order_number,
      status: row.status
    });

  } catch (err) {
    console.error('Fehler beim Aktualisieren des Status:', err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Status' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------
// PATCH /orders/:id/payment – Zahlungsstatus ändern
// Body: { paymentStatus: "PAID" }
// ---------------------------------------------
app.patch('/orders/:id/payment', async (req, res) => {
  const orderId = Number(req.params.id);
  const newPaymentStatus = (req.body?.paymentStatus || '').trim().toUpperCase();

  if (!orderId || Number.isNaN(orderId)) {
    return res.status(400).json({ error: 'Ungültige Order-ID' });
  }

  // Erlaubte Payment-Status (kannst du später erweitern)
  const allowed = ['OPEN', 'PAID', 'FAILED', 'REFUNDED'];
  if (!allowed.includes(newPaymentStatus)) {
    return res.status(400).json({
      error: `Ungültiger Zahlungsstatus. Erlaubt: ${allowed.join(', ')}`
    });
  }

  const client = await pool.connect().catch((err) => {
    console.error('PATCH /orders/:id/payment – DB Fehler:', err);
    return null;
  });

  if (!client) {
    return res.status(500).json({ error: 'Datenbank nicht erreichbar.' });
  }

  try {
    const update = await client.query(
      `
      UPDATE orders
      SET payment_status = $1
      WHERE id = $2
      RETURNING id, order_number, payment_status
      `,
      [newPaymentStatus, orderId]
    );

    if (update.rows.length === 0) {
      return res.status(404).json({ error: 'Bestellung nicht gefunden' });
    }

    const row = update.rows[0];

    res.json({
      success: true,
      id: row.id,
      orderNumber: row.order_number,
      paymentStatus: row.payment_status
    });

  } catch (err) {
    console.error('Fehler beim Aktualisieren des Zahlungsstatus:', err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Zahlungsstatus' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------
// Root
// ---------------------------------------------
app.get('/', (req, res) => {
  res.send('MildAsianFire API läuft');
});

app.listen(PORT, () => {
  console.log(`MildAsianFire Backend läuft auf Port ${PORT}`);
});
