// server.js
import express from 'express';
import { pool } from './db.js';

const app = express();
const PORT = process.env.PORT || 3000;

// --- CORS erlauben (wichtig für Browser-Frontend) ---
app.use((req, res, next) => {
  // Für den Anfang: alles erlauben
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
      RETURNING id
      `,
      [
        order.id,
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

    // 3. Positionen
    for (const item of order.items) {
      const { sku, name, qty, price } = item;

      if (!sku || !name || !qty || !price) {
        throw new Error('Ungültige Position in Bestellung');
      }

      const productRes = await client.query(
        `SELECT id FROM products WHERE sku = $1`,
        [sku]
      );

      if (productRes.rows.length === 0) {
        throw new Error(`Produkt mit SKU ${sku} nicht gefunden`);
      }

      const productId = productRes.rows[0].id;

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
    }

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      orderId,
      orderNumber: order.id
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fehler beim Speichern der Bestellung:', err);
    res.status(500).json({ error: 'Fehler beim Speichern der Bestellung' });
  } finally {
    client.release();
  }
});

app.get('/', (req, res) => {
  res.send('MildAsianFire API läuft');
});

app.listen(PORT, () => {
  console.log(`MildAsianFire Backend läuft auf Port ${PORT}`);
});

