package com.appkiosk.phone;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class KioskDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "food_kiosk.db";
    private static final int DATABASE_VERSION = 2;
    private static final Pattern COLOR_PATTERN = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Pattern LOCAL_VIDEO_PATTERN = Pattern.compile("^/media/[A-Za-z0-9._-]{1,120}$");
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
        database.execSQL("CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_paise INTEGER NOT NULL DEFAULT 0, image TEXT, emoji TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1, video_url TEXT NOT NULL DEFAULT '')");
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
        if (oldVersion < 2) {
            database.execSQL("ALTER TABLE products ADD COLUMN video_url TEXT NOT NULL DEFAULT ''");
            seedAppearanceSettings(database);
        }
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
                try (Cursor products = database.rawQuery("SELECT id,name,description,price_paise,image,emoji,video_url FROM products WHERE category_id=? AND available=1 ORDER BY sort_order,id", new String[]{String.valueOf(categories.getInt(0))})) {
                    while (products.moveToNext()) {
                        JSONObject item = new JSONObject();
                        item.put("id", products.getInt(0));
                        item.put("name", products.getString(1));
                        item.put("description", products.getString(2));
                        item.put("price", products.getInt(3) / 100.0);
                        item.put("pricePaise", products.getInt(3));
                        item.put("image", products.isNull(4) ? JSONObject.NULL : products.getString(4));
                        item.put("emoji", products.getString(5));
                        item.put("videoUrl", products.getString(6));
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

    public JSONObject adminConfiguration() throws JSONException {
        JSONObject result = new JSONObject();
        result.put("settings", settings());
        JSONArray products = new JSONArray();
        try (Cursor rows = getReadableDatabase().rawQuery(
                "SELECT p.id,p.category_id,c.name,p.name,p.description,p.price_paise,p.sort_order,p.available,p.video_url " +
                        "FROM products p JOIN categories c ON c.id=p.category_id ORDER BY c.sort_order,c.id,p.sort_order,p.id",
                null
        )) {
            while (rows.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("id", rows.getInt(0));
                item.put("categoryId", rows.getInt(1));
                item.put("category", rows.getString(2));
                item.put("name", rows.getString(3));
                item.put("description", rows.getString(4));
                item.put("pricePaise", rows.getInt(5));
                item.put("sortOrder", rows.getInt(6));
                item.put("available", rows.getInt(7) != 0);
                item.put("videoUrl", rows.getString(8));
                products.put(item);
            }
        }
        result.put("products", products);
        return result;
    }

    public void saveAdminConfiguration(JSONObject request) throws JSONException {
        JSONObject appearance = request.optJSONObject("appearance");
        JSONArray products = request.optJSONArray("products");
        if (appearance == null) throw new IllegalArgumentException("Appearance settings are required.");

        String theme = appearance.optString("theme", "light");
        if (!"light".equals(theme) && !"dark".equals(theme) && !"neon".equals(theme)) {
            throw new IllegalArgumentException("Choose light, dark, or neon theme.");
        }
        String accentColor = appearance.optString("accentColor", "#b64f2c");
        if (!COLOR_PATTERN.matcher(accentColor).matches()) {
            throw new IllegalArgumentException("Accent color must be a six-digit hex color.");
        }
        String backgroundVideo = validateVideoUrl(appearance.optString("backgroundVideo", ""));
        int backgroundOpacity = appearance.optInt("backgroundOpacity", 12);
        if (backgroundOpacity < 3 || backgroundOpacity > 24) {
            throw new IllegalArgumentException("Background opacity must be between 3 and 24.");
        }
        boolean neonBorders = appearance.optBoolean("neonBorders", false);

        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            putSetting(database, "kiosk_theme", theme);
            putSetting(database, "kiosk_accent_color", accentColor.toLowerCase(Locale.ROOT));
            putSetting(database, "kiosk_neon_borders", neonBorders ? "1" : "0");
            putSetting(database, "kiosk_background_video", backgroundVideo);
            putSetting(database, "kiosk_background_opacity", String.valueOf(backgroundOpacity));
            if (products != null) {
                for (int i = 0; i < products.length(); i++) {
                    JSONObject product = products.optJSONObject(i);
                    if (product == null) throw new IllegalArgumentException("One of the menu items is invalid.");
                    long id = product.optLong("id", -1);
                    String name = product.optString("name", "").trim();
                    String description = product.optString("description", "").trim();
                    double price = product.optDouble("price", Double.NaN);
                    int sortOrder = product.optInt("sortOrder", Integer.MIN_VALUE);
                    boolean available = product.optBoolean("available", true);
                    String videoUrl = validateVideoUrl(product.optString("videoUrl", ""));
                    if (id <= 0 || name.isEmpty() || name.length() > 80 ||
                            description.length() > 200 || !Double.isFinite(price) ||
                            price < 0 || price > 100000 || sortOrder < 0 || sortOrder > 9999) {
                        throw new IllegalArgumentException("Check menu names, prices, and display positions.");
                    }
                    ContentValues values = new ContentValues();
                    values.put("name", name);
                    values.put("description", description);
                    values.put("price_paise", Math.round(price * 100));
                    values.put("sort_order", sortOrder);
                    values.put("available", available ? 1 : 0);
                    values.put("video_url", videoUrl);
                    int updated = database.update("products", values, "id=?", new String[]{String.valueOf(id)});
                    if (updated != 1) throw new IllegalArgumentException("A menu item no longer exists. Reload and try again.");
                }
            }
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }

    private String validateVideoUrl(String value) {
        String url = value.trim();
        if (url.isEmpty()) return "";
        if (url.length() > 2048) throw new IllegalArgumentException("Video URL is too long.");
        if (LOCAL_VIDEO_PATTERN.matcher(url).matches()) return url;
        try {
            URI parsed = URI.create(url);
            if ("https".equalsIgnoreCase(parsed.getScheme()) && parsed.getHost() != null &&
                    (parsed.getPath().toLowerCase(Locale.ROOT).endsWith(".mp4") ||
                            parsed.getPath().toLowerCase(Locale.ROOT).endsWith(".webm"))) {
                return url;
            }
        } catch (IllegalArgumentException ignored) {
            throw new IllegalArgumentException("Use a local uploaded video or a direct HTTPS MP4/WebM URL.");
        }
        throw new IllegalArgumentException("Use a local uploaded video or a direct HTTPS MP4/WebM URL.");
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
        seedAppearanceSettings(database);
    }

    private void seedAppearanceSettings(SQLiteDatabase database) {
        putSettingIfMissing(database, "kiosk_theme", "light");
        putSettingIfMissing(database, "kiosk_accent_color", "#b64f2c");
        putSettingIfMissing(database, "kiosk_neon_borders", "0");
        putSettingIfMissing(database, "kiosk_background_video", "/media/food-atmosphere.mp4");
        putSettingIfMissing(database, "kiosk_background_opacity", "12");
    }

    private void putSettingIfMissing(SQLiteDatabase database, String key, String value) {
        ContentValues setting = new ContentValues();
        setting.put("key", key);
        setting.put("value", value);
        database.insertWithOnConflict("settings", null, setting, SQLiteDatabase.CONFLICT_IGNORE);
    }

    private void putSetting(SQLiteDatabase database, String key, String value) {
        ContentValues setting = new ContentValues();
        setting.put("key", key);
        setting.put("value", value);
        database.insert("settings", null, setting);
    }
}