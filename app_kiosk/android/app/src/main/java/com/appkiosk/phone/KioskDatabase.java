package com.appkiosk.phone;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class KioskDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "food_kiosk.db";
    private static final int DATABASE_VERSION = 1;
    private static KioskDatabase instance;

    public static synchronized KioskDatabase get(Context context) {
        if (instance == null) {
            instance = new KioskDatabase(context.getApplicationContext());
        }
        return instance;
    }

    private KioskDatabase(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        database.execSQL("CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1)");
        database.execSQL("CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_paise INTEGER NOT NULL DEFAULT 0, image TEXT, emoji TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1)");
        database.execSQL("CREATE TABLE modifier_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'addon', required INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0)");
        database.execSQL("CREATE TABLE modifiers (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, name TEXT NOT NULL, price_paise INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0)");
        database.execSQL("CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number INTEGER NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'awaiting_payment', payment_status TEXT NOT NULL DEFAULT 'pending', subtotal_paise INTEGER NOT NULL DEFAULT 0, tax_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paid_at TEXT, completed_at TEXT)");
        database.execSQL("CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER, name TEXT NOT NULL, unit_paise INTEGER NOT NULL, qty INTEGER NOT NULL, total_paise INTEGER NOT NULL, modifiers TEXT NOT NULL DEFAULT '[]')");
        database.execSQL("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
        database.execSQL("CREATE TABLE print_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'receipt', status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, printed_at TEXT)");
        seed(database);
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
    }

    public JSONArray menu() throws JSONException {
        SQLiteDatabase database = getReadableDatabase();
        JSONArray result = new JSONArray();
        try (Cursor categories = database.rawQuery("SELECT id,name,emoji FROM categories WHERE available=1 ORDER BY sort_order,id", null)) {
            while (categories.moveToNext()) {
                JSONObject category = new JSONObject();
                category.put("id", categories.getInt(0));
                category.put("name", categories.getString(1));
                category.put("emoji", categories.getString(2));
                JSONArray items = new JSONArray();
                try (Cursor products = database.rawQuery("SELECT id,name,description,price_paise,image,emoji FROM products WHERE category_id=? AND available=1 ORDER BY sort_order,id", new String[]{String.valueOf(categories.getInt(0))})) {
                    while (products.moveToNext()) {
                        JSONObject item = new JSONObject();
                        item.put("id", products.getInt(0));
                        item.put("name", products.getString(1));
                        item.put("description", products.getString(2));
                        item.put("price", products.getInt(3) / 100.0);
                        item.put("pricePaise", products.getInt(3));
                        item.put("image", products.isNull(4) ? JSONObject.NULL : products.getString(4));
                        item.put("emoji", products.getString(5));
                        items.put(item);
                    }
                }
                category.put("items", items);
                result.put(category);
            }
        }
        return result;
    }

    public JSONObject settings() throws JSONException {
        JSONObject result = new JSONObject();
        try (Cursor rows = getReadableDatabase().rawQuery("SELECT key,value FROM settings", null)) {
            while (rows.moveToNext()) result.put(rows.getString(0), rows.getString(1));
        }
        return result;
    }

    private void seed(SQLiteDatabase database) {
        String[][] categories = {
                {"FRIES", "🍟"}, {"CHICKEN", "🍗"}, {"ROLLS", "🌯"}, {"EXTRAS", "🧀"}
        };
        String[][][] products = {
                {{"Salt Fries", "Crispy golden fries with sea salt", "7900"}, {"Peri Peri Fries", "Fries tossed in fiery peri peri masala", "9900"}, {"Garlic Fries", "Buttery garlic fries with herbs", "9900"}, {"Manchuri Fries", "Indo-Chinese tangy manchurian fries", "10900"}},
                {{"Plain Chicken", "Simple, juicy, perfectly salted", "14900"}, {"Peri Peri Chicken", "Spicy peri peri coating", "17900"}, {"Loaded Chicken", "Piled high with sauces and crunch", "19900"}, {"Ghee Garlic Chicken", "Roasted in desi ghee and garlic", "21900"}, {"Loaded Ghee Garlic Chicken", "The full works — ghee, garlic, loaded", "24900"}},
                {{"Crispy Jumbo Chicken Roll", "Double filling, flaky paratha wrap", "14900"}, {"Jumbo Garlic Chicken Roll", "Garlic mayo + crispy chicken", "15900"}, {"Jumbo Fries Roll", "Fries rolled into a jumbo wrap", "12900"}, {"Try Special Bun Fries", "Our signature bun loaded with fries", "11900"}},
                {{"Melted Cheese", "Molten cheese topping", "2500"}}
        };
        for (int categoryIndex = 0; categoryIndex < categories.length; categoryIndex++) {
            ContentValues category = new ContentValues();
            category.put("name", categories[categoryIndex][0]);
            category.put("emoji", categories[categoryIndex][1]);
            category.put("sort_order", categoryIndex);
            long categoryId = database.insert("categories", null, category);
            for (int itemIndex = 0; itemIndex < products[categoryIndex].length; itemIndex++) {
                String[] source = products[categoryIndex][itemIndex];
                ContentValues product = new ContentValues();
                product.put("category_id", categoryId);
                product.put("name", source[0]);
                product.put("description", source[1]);
                product.put("price_paise", Integer.parseInt(source[2]));
                product.put("emoji", categories[categoryIndex][1]);
                product.put("sort_order", itemIndex);
                database.insert("products", null, product);
            }
        }

        putSetting(database, "business_name", "FOOD TRUCK");
        putSetting(database, "business_tagline", "FRESH • HOT • FAST");
        putSetting(database, "gst_percent", "18");
        putSetting(database, "gst_label", "GST incl");
        putSetting(database, "show_gst_on_receipt", "1");
        putSetting(database, "currency_symbol", "₹");
        putSetting(database, "receipt_footer", "Thank you! Please visit again.");
        putSetting(database, "paper_width_chars", "32");
        putSetting(database, "auto_reset_seconds", "20");
        putSetting(database, "max_qty_per_item", "10");
        putSetting(database, "demo_mode", "1");
        putSetting(database, "printer_driver", "simulated");
        putSetting(database, "printer_host", "");
        putSetting(database, "printer_port", "9100");
    }

    private void putSetting(SQLiteDatabase database, String key, String value) {
        ContentValues setting = new ContentValues();
        setting.put("key", key);
        setting.put("value", value);
        database.insert("settings", null, setting);
    }
}