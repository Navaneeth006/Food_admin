/**
 * Seed demo data: the exact menu from the spec, clearly marked as placeholder
 * prices. Run `npm run seed` (add --reset to wipe orders first).
 */
import { db } from './database.js';

const reset = process.argv.includes('--reset');
if (reset) {
  db.exec(
    'DELETE FROM order_items; DELETE FROM payments; DELETE FROM print_jobs; DELETE FROM orders;' +
    'DELETE FROM modifiers; DELETE FROM modifier_groups; DELETE FROM products; DELETE FROM categories;'
  );
  console.log('Orders + menu wiped.');
}

const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (count > 0) {
  console.log('Menu already seeded — skipping. Use --reset to wipe orders + menu, or edit via /admin.');
  process.exit(0);
}

// placeholder prices, in rupees — replace from the admin dashboard
const menu = [
  {
    name: 'FRIES', emoji: '🍟',
    items: [
      ['Salt Fries', 'Crispy golden fries with sea salt', 79],
      ['Peri Peri Fries', 'Fries tossed in fiery peri peri masala', 99],
      ['Garlic Fries', 'Buttery garlic fries with herbs', 99],
      ['Manchuri Fries', 'Indo-Chinese tangy manchurian fries', 109],
    ],
  },
  {
    name: 'CHICKEN', emoji: '🍗',
    items: [
      ['Plain Chicken', 'Simple, juicy, perfectly salted', 149],
      ['Peri Peri Chicken', 'Spicy peri peri coating', 179],
      ['Loaded Chicken', 'Piled high with sauces and crunch', 199],
      ['Ghee Garlic Chicken', 'Roasted in desi ghee and garlic', 219],
      ['Loaded Ghee Garlic Chicken', 'The full works — ghee, garlic, loaded', 249],
    ],
  },
  {
    name: 'ROLLS', emoji: '🌯',
    items: [
      ['Crispy Jumbo Chicken Roll', 'Double filling, flaky paratha wrap', 149],
      ['Jumbo Garlic Chicken Roll', 'Garlic mayo + crispy chicken', 159],
      ['Jumbo Fries Roll', 'Fries rolled into a jumbo wrap', 129],
      ['Try Special Bun Fries', 'Our signature bun loaded with fries', 119],
    ],
  },
  {
    name: 'EXTRAS', emoji: '🧀',
    items: [
      ['Melted Cheese', 'Molten cheese topping', 25],
    ],
  },
];

let seededCats = 0;
const seedTx = db.transaction(() => {
  for (const [ci, cat] of menu.entries()) {
    const catInfo = db.prepare('INSERT INTO categories (name, emoji, sort_order) VALUES (?,?,?)').run(cat.name, cat.emoji, ci);
    const catId = catInfo.lastInsertRowid;
    for (const [ii, [name, desc, price]] of cat.items.entries()) {
      db.prepare(
        'INSERT INTO products (category_id, name, description, price_paise, emoji, sort_order) VALUES (?,?,?,?,?,?)'
      ).run(catId, name, desc, price * 100, cat.emoji, ii);
    }
    seededCats++;
  }

  // default extras group available on every item (addon-style)
  const g = db.prepare("INSERT INTO modifier_groups (product_id, name, type) VALUES (NULL, 'Extras', 'addon')").run();
  for (const [name, price] of [['Melted Cheese', 2500], ['Extra Sauce', 1000], ['Extra Spice', 500]]) {
    db.prepare('INSERT INTO modifiers (group_id, name, price_paise) VALUES (?,?,?)').run(g.lastInsertRowid, name, price);
  }
});
seedTx();

console.log(`Seeded ${seededCats} categories with demo (placeholder) prices.`);
console.log('Edit them in the Admin dashboard → Menu, or run `npm run seed -- --reset` to reseed.');
