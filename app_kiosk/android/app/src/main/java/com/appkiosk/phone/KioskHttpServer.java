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
    private final KioskDatabase database;

    public KioskHttpServer(Context context) throws IOException {
        super("0.0.0.0", SERVER_PORT);
        this.context = context.getApplicationContext();
        this.preferences = this.context.getSharedPreferences(
                KioskServerService.PREFERENCES_NAME,
                Context.MODE_PRIVATE
        );
        this.database = KioskDatabase.get(this.context);
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
                result.put("categories", database.menu());
                result.put("menu", flattenMenu(database.menu()));
                JSONObject business = database.settings();
                business.put("name", business.optString("business_name", "FOOD KIOSK"));
                result.put("business", business);
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Menu unavailable\"}");
            }
            return json(Response.Status.OK, result.toString());
        }
        if (Method.POST.equals(method) && "/api/orders".equals(uri)) {
            return createOrder(session);
        }
        if (Method.POST.equals(method) && uri.matches("/api/admin/orders/[0-9]+/mark-paid")) {
            int orderId = Integer.parseInt(uri.split("/")[4]);
            java.util.List<String> paymentMethods = session.getParameters().get("method");
            String paymentMethod = paymentMethods == null || paymentMethods.isEmpty() ? "cash" : paymentMethods.get(0);
            if (!"cash".equalsIgnoreCase(paymentMethod) && !"upi".equalsIgnoreCase(paymentMethod)) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"Payment method must be cash or upi\"}");
            }
            try {
                return markOrderPaid(orderId, paymentMethod);
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Could not settle order\"}");
            }
        }
        if (Method.POST.equals(method) && uri.matches("/api/admin/orders/[0-9]+/print")) {
            int orderId = Integer.parseInt(uri.split("/")[4]);
            try {
                return reprintOrder(orderId);
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Could not print bill\"}");
            }
        }
        if (Method.GET.equals(method) && "/api/admin/orders".equals(uri)) {
            JSONObject result = new JSONObject();
            try {
                result.put("orders", readOrders());
                return json(Response.Status.OK, result.toString());
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Orders unavailable\"}");
            }
        }
        if (Method.GET.equals(method) && "/api/admin/printer".equals(uri)) {
            JSONObject result = new JSONObject();
            try {
                String address = BluetoothPrinter.selectedAddress(context);
                result.put("driver", "bluetooth");
                result.put("configured", !address.isEmpty());
                result.put("address", address);
                result.put("hint", address.isEmpty() ? "Pair and select a Bluetooth printer in the phone app." : "Selected Bluetooth printer: " + address);
                return json(Response.Status.OK, result.toString());
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Printer status unavailable\"}");
            }
        }
        if (Method.POST.equals(method) && "/api/admin/printer/test".equals(uri)) {
            try {
                BluetoothPrinter.print(context, BluetoothPrinter.testReceipt());
                return json(Response.Status.OK, "{\"ok\":true}");
            } catch (Exception exception) {
                return json(Response.Status.BAD_REQUEST, "{\"ok\":false,\"message\":\"" + escapeJson(exception.getMessage()) + "\"}");
            }
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

    private synchronized Response createOrder(IHTTPSession session) {
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
            int orderId = 0;
            int lastTokenNumber = Math.max(100, preferences.getInt("last_token_number", 100));
            for (int i = 0; i < orders.length(); i++) {
                JSONObject previous = orders.optJSONObject(i);
                if (previous == null) continue;
                orderId = Math.max(orderId, previous.optInt("id"));
                lastTokenNumber = Math.max(
                        lastTokenNumber,
                        previous.optInt("tokenNumber", previous.optInt("id") + 100)
                );
            }
            int tokenNumber = lastTokenNumber + 1;
            order.put("id", orderId + 1);
            order.put("tokenNumber", tokenNumber);
            order.put("customerName", request.optString("customerName", "Walk-in"));
            order.put("items", items);
            order.put("total", total);
            order.put("status", "awaiting_payment");
            order.put("paymentStatus", "pending");
            order.put("printStatus", "none");
            order.put("createdAt", System.currentTimeMillis());
            try {
                BluetoothPrinter.print(context, receiptBytes(order));
                order.put("printStatus", "printed");
            } catch (Exception exception) {
                order.put("printStatus", "failed");
                order.put("printError", exception.getMessage());
            }
            orders.put(order);
            preferences.edit()
                    .putString(PREF_ORDERS, orders.toString())
                    .putInt("last_token_number", tokenNumber)
                    .apply();

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
                if ("paid".equals(order.optString("paymentStatus"))) revenue += order.optDouble("total", 0);
                if ("pending".equals(order.optString("paymentStatus"))) pending++;
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

    private Response markOrderPaid(int orderId, String paymentMethod) throws JSONException {
        JSONArray orders = readOrders();
        for (int i = 0; i < orders.length(); i++) {
            JSONObject order = orders.optJSONObject(i);
            if (order == null || order.optInt("id") != orderId) continue;
            if (!"paid".equals(order.optString("paymentStatus"))) {
                order.put("paymentStatus", "paid");
                order.put("paymentMethod", "upi".equalsIgnoreCase(paymentMethod) ? "upi" : "cash");
                order.put("status", "new");
                order.put("paidAt", System.currentTimeMillis());
                preferences.edit().putString(PREF_ORDERS, orders.toString()).apply();
            }
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("order", order);
            return json(Response.Status.OK, result.toString());
        }
        return json(Response.Status.NOT_FOUND, "{\"error\":\"Order not found\"}");
    }

    private Response reprintOrder(int orderId) throws JSONException {
        JSONArray orders = readOrders();
        for (int i = 0; i < orders.length(); i++) {
            JSONObject order = orders.optJSONObject(i);
            if (order == null || order.optInt("id") != orderId) continue;
            try {
                BluetoothPrinter.print(context, receiptBytes(order));
                order.put("printStatus", "printed");
                order.remove("printError");
                preferences.edit().putString(PREF_ORDERS, orders.toString()).apply();
                return json(Response.Status.OK, "{\"ok\":true}");
            } catch (Exception exception) {
                order.put("printStatus", "failed");
                order.put("printError", exception.getMessage());
                preferences.edit().putString(PREF_ORDERS, orders.toString()).apply();
                return json(Response.Status.INTERNAL_ERROR,
                        "{\"error\":\"" + escapeJson(exception.getMessage()) + "\"}");
            }
        }
        return json(Response.Status.NOT_FOUND, "{\"error\":\"Order not found\"}");
    }

    private byte[] receiptBytes(JSONObject order) throws JSONException {
        StringBuilder receipt = new StringBuilder();
        int tokenNumber = order.optInt("tokenNumber", order.optInt("id") + 100);
        String businessName = database.settings().optString("business_name", "FOOD KIOSK");
        String orderTime = new java.text.SimpleDateFormat(
                "dd/MM/yyyy hh:mm a",
                java.util.Locale.getDefault()
        ).format(new java.util.Date(order.optLong("createdAt", System.currentTimeMillis())));
        receipt.append("\u001b@\u001ba\u0001").append(businessName).append('\n')
                .append("KITCHEN ORDER\n")
                .append("\u001ba\u0000TOKEN #").append(tokenNumber).append('\n')
                .append(orderTime).append('\n')
                .append("------------------------------\n");
        JSONArray items = order.optJSONArray("items");
        if (items != null) {
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null) continue;
                receipt.append(item.optString("name")).append(" x")
                        .append(item.optInt("qty", 1)).append("  INR ")
                        .append(String.format(java.util.Locale.US, "%.2f", item.optDouble("price") * item.optInt("qty", 1)))
                        .append('\n');
            }
        }
        receipt.append("\n---------- CUT HERE ----------\n")
                .append("\u001dV\u0001")
                .append("\u001ba\u0001CUSTOMER TOKEN\n")
                .append("\u001ba\u0000TOKEN #").append(tokenNumber).append('\n')
                .append("------------------------------\nAMOUNT DUE INR ")
                .append(String.format(java.util.Locale.US, "%.2f", order.optDouble("total")))
                .append("\nPAY AT COUNTER\nCASH OR PHONEPE UPI\n\n\n\u001dV\u0000");
        return receipt.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private String escapeJson(String value) {
        return value == null ? "Printer error" : value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
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

    private JSONArray flattenMenu(JSONArray categories) throws JSONException {
        JSONArray result = new JSONArray();
        for (int categoryIndex = 0; categoryIndex < categories.length(); categoryIndex++) {
            JSONObject category = categories.getJSONObject(categoryIndex);
            JSONArray items = category.getJSONArray("items");
            for (int itemIndex = 0; itemIndex < items.length(); itemIndex++) {
                JSONObject item = new JSONObject(items.getJSONObject(itemIndex).toString());
                item.put("category", category.getString("name"));
                result.put(item);
            }
        }
        return result;
    }

    private JSONObject findMenuItem(int id) throws JSONException {
        JSONArray menu = flattenMenu(database.menu());
        for (int i = 0; i < menu.length(); i++) {
            JSONObject item = menu.getJSONObject(i);
            if (item.getInt("id") == id) {
                return item;
            }
        }
        return null;
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