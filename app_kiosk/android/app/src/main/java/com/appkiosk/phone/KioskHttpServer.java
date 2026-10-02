package com.appkiosk.phone;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import fi.iki.elonen.NanoHTTPD;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class KioskHttpServer extends NanoHTTPD {
    public static final int SERVER_PORT = 4242;
    private static final String PREF_ORDERS = "orders_json";

    private final Context context;
    private final SharedPreferences preferences;

    public KioskHttpServer(Context context) throws IOException {
        super("0.0.0.0", SERVER_PORT);
        this.context = context.getApplicationContext();
        this.preferences = this.context.getSharedPreferences(
                KioskServerService.PREFERENCES_NAME,
                Context.MODE_PRIVATE
        );
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();

        if (Method.GET.equals(method) && "/api/health".equals(uri)) {
            JSONObject health = new JSONObject();
            try {
                health.put("ok", true);
                health.put("service", "food-kiosk");
            } catch (JSONException ignored) {
                return json(Response.Status.INTERNAL_ERROR, "{\"ok\":false}");
            }
            return json(Response.Status.OK, health.toString());
        }
        if (Method.GET.equals(method) && "/api/menu".equals(uri)) {
            JSONObject result = new JSONObject();
            try {
                result.put("menu", createMenu());
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Menu unavailable\"}");
            }
            return json(Response.Status.OK, result.toString());
        }
        if (Method.POST.equals(method) && "/api/orders".equals(uri)) {
            return createOrder(session);
        }
        if (Method.GET.equals(method) && "/api/orders".equals(uri)) {
            JSONObject result = new JSONObject();
            try {
                result.put("orders", readOrders());
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Orders unavailable\"}");
            }
            return json(Response.Status.OK, result.toString());
        }
        if (Method.POST.equals(method) && "/api/admin/login".equals(uri)) {
            return adminLogin(session);
        }
        if (Method.GET.equals(method) && "/api/admin/stats".equals(uri)) {
            return adminStats();
        }
        if (Method.GET.equals(method)) {
            return serveAsset(uri);
        }
        return json(Response.Status.NOT_FOUND, "{\"error\":\"Not found\"}");
    }

    private Response createOrder(IHTTPSession session) {
        try {
            JSONObject request = readJsonBody(session);
            JSONArray cart = request.optJSONArray("cart");
            if (cart == null || cart.length() == 0) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"Cart is empty\"}");
            }

            JSONArray items = new JSONArray();
            double total = 0;
            for (int i = 0; i < cart.length(); i++) {
                JSONObject requestedItem = cart.optJSONObject(i);
                if (requestedItem == null) {
                    continue;
                }
                JSONObject item = findMenuItem(requestedItem.optInt("id", -1));
                if (item == null) {
                    return json(Response.Status.BAD_REQUEST, "{\"error\":\"Unknown menu item\"}");
                }

                int quantity = Math.max(1, Math.min(99, requestedItem.optInt("qty", 1)));
                JSONObject orderedItem = new JSONObject(item.toString());
                orderedItem.put("qty", quantity);
                total += item.getDouble("price") * quantity;
                items.put(orderedItem);
            }

            if (items.length() == 0) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"Cart is empty\"}");
            }

            JSONArray orders = readOrders();
            JSONObject order = new JSONObject();
            order.put("id", orders.length() + 1);
            order.put("customerName", request.optString("customerName", "Walk-in"));
            order.put("items", items);
            order.put("total", total);
            order.put("status", "new");
            orders.put(order);
            preferences.edit().putString(PREF_ORDERS, orders.toString()).apply();

            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("order", order);
            return json(Response.Status.OK, result.toString());
        } catch (Exception exception) {
            return json(Response.Status.BAD_REQUEST, "{\"error\":\"Invalid order request\"}");
        }
    }

    private Response adminLogin(IHTTPSession session) {
        try {
            JSONObject request = readJsonBody(session);
            if ("1234".equals(request.optString("pin"))) {
                JSONObject result = new JSONObject();
                result.put("ok", true);
                result.put("message", "Admin logged in");
                return json(Response.Status.OK, result.toString());
            }
            return json(Response.Status.UNAUTHORIZED, "{\"ok\":false,\"message\":\"Invalid PIN\"}");
        } catch (Exception exception) {
            return json(Response.Status.BAD_REQUEST, "{\"ok\":false,\"message\":\"Invalid request\"}");
        }
    }

    private Response adminStats() {
        JSONArray orders = readOrders();
        double revenue = 0;
        int pending = 0;
        for (int i = 0; i < orders.length(); i++) {
            JSONObject order = orders.optJSONObject(i);
            if (order != null) {
                revenue += order.optDouble("total", 0);
                if (!"done".equals(order.optString("status"))) {
                    pending++;
                }
            }
        }

        JSONObject result = new JSONObject();
        try {
            result.put("orders", orders.length());
            result.put("totalRevenue", revenue);
            result.put("pending", pending);
        } catch (JSONException exception) {
            return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Stats unavailable\"}");
        }
        return json(Response.Status.OK, result.toString());
    }

    private JSONObject readJsonBody(IHTTPSession session) throws Exception {
        Map<String, String> files = new HashMap<>();
        session.parseBody(files);
        String body = files.get("postData");
        return new JSONObject(body == null ? "{}" : body);
    }

    private JSONArray readOrders() {
        String stored = preferences.getString(PREF_ORDERS, "[]");
        try {
            return new JSONArray(stored);
        } catch (JSONException exception) {
            return new JSONArray();
        }
    }

    private JSONArray createMenu() throws JSONException {
        JSONArray menu = new JSONArray();
        menu.put(menuItem(1, "Burger", 120, "Main"));
        menu.put(menuItem(2, "Fries", 80, "Sides"));
        menu.put(menuItem(3, "Cold Coffee", 90, "Drinks"));
        menu.put(menuItem(4, "Pizza Slice", 150, "Main"));
        return menu;
    }

    private JSONObject findMenuItem(int id) throws JSONException {
        JSONArray menu = createMenu();
        for (int i = 0; i < menu.length(); i++) {
            JSONObject item = menu.getJSONObject(i);
            if (item.getInt("id") == id) {
                return item;
            }
        }
        return null;
    }

    private JSONObject menuItem(int id, String name, int price, String category) throws JSONException {
        JSONObject item = new JSONObject();
        item.put("id", id);
        item.put("name", name);
        item.put("price", price);
        item.put("category", category);
        return item;
    }

    private Response serveAsset(String uri) {
        String assetPath = "/".equals(uri) ? "connect.html" : uri.substring(1);
        if (assetPath.contains("..") || assetPath.isEmpty()) {
            return text(Response.Status.BAD_REQUEST, "Invalid path");
        }

        try (InputStream input = context.getAssets().open("public/" + assetPath);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            String mimeType = NanoHTTPD.getMimeTypeForFile(assetPath);
            return newFixedLengthResponse(
                    Response.Status.OK,
                    mimeType == null ? "application/octet-stream" : mimeType,
                    new java.io.ByteArrayInputStream(output.toByteArray()),
                    output.size()
            );
        } catch (IOException exception) {
            return text(Response.Status.NOT_FOUND, "File not found");
        }
    }

    private Response json(Response.IStatus status, String body) {
        return newFixedLengthResponse(status, "application/json; charset=utf-8", body);
    }

    private Response text(Response.IStatus status, String body) {
        return newFixedLengthResponse(status, "text/plain; charset=utf-8", body);
    }
}