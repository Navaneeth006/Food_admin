package com.appkiosk.phone;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import fi.iki.elonen.NanoHTTPD;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class KioskHttpServer extends NanoHTTPD {
    public static final int SERVER_PORT = 4242;
    private static final String PREF_ORDERS = "orders_json";

    private final Context context;
    private final SharedPreferences preferences;
    private final KioskDatabase database;
    private final ExecutorService printQueue = Executors.newSingleThreadExecutor();

    public KioskHttpServer(Context context) throws IOException {
        super("0.0.0.0", SERVER_PORT);
        this.context = context.getApplicationContext();
        this.preferences = this.context.getSharedPreferences(
                KioskServerService.PREFERENCES_NAME,
                Context.MODE_PRIVATE
        );
        this.database = KioskDatabase.get(this.context);
        resumeQueuedPrints();
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();

        if (uri.startsWith("/api/admin/") && !isInAppAdminRequest(session)) {
            return json(Response.Status.FORBIDDEN, "{\"error\":\"Admin controls are available in the Food Kiosk app only.\"}");
        }
        if (Method.OPTIONS.equals(method)) {
            return cors(newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", ""));
        }
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
        if (Method.GET.equals(method) && uri.matches("/api/orders/[0-9]+/status")) {
            int orderId = Integer.parseInt(uri.split("/")[3]);
            JSONObject order = findOrder(orderId);
            if (order == null) return json(Response.Status.NOT_FOUND, "{\"error\":\"Order not found\"}");
            JSONObject status = new JSONObject();
            try {
                status.put("orderId", orderId);
                status.put("tokenNumber", order.optInt("tokenNumber", orderId + 100));
                status.put("billPrintStatus", order.optString("billPrintStatus", "unknown"));
                status.put("tokenPrintStatus", order.optString("tokenPrintStatus", "unknown"));
                status.put("printStatus", order.optString("printStatus", "unknown"));
                return json(Response.Status.OK, status.toString());
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Order status is unavailable\"}");
            }
        }
        if (Method.POST.equals(method) && "/api/orders".equals(uri)) {
            return createOrder(session);
        }
        if (Method.POST.equals(method) && uri.matches("/api/admin/orders/[0-9]+/print")) {
            int orderId = Integer.parseInt(uri.split("/")[4]);
            try {
                queueOrderPrint(orderId);
                return json(Response.Status.OK, "{\"ok\":true,\"message\":\"Both print slips queued\"}");
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Could not print bill\"}");
            } catch (IllegalArgumentException exception) {
                return json(Response.Status.NOT_FOUND, "{\"error\":\"Order not found\"}");
            }
        }
        if (Method.POST.equals(method) && uri.matches("/api/admin/orders/[0-9]+/print/(bill|token)")) {
            int orderId = Integer.parseInt(uri.split("/")[4]);
            String kind = uri.substring(uri.lastIndexOf('/') + 1);
            try {
                queuePrintRetry(orderId, kind);
                return json(Response.Status.OK, "{\"ok\":true,\"message\":\"Print retry queued\"}");
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Could not queue print retry\"}");
            } catch (IllegalArgumentException exception) {
                return json(Response.Status.NOT_FOUND, "{\"error\":\"Order not found\"}");
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
        if (Method.GET.equals(method) && "/api/admin/config".equals(uri)) {
            try {
                return json(Response.Status.OK, database.adminConfiguration().toString());
            } catch (JSONException exception) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Menu settings are unavailable\"}");
            }
        }
        if (Method.POST.equals(method) && "/api/admin/config".equals(uri)) {
            try {
                JSONObject request = readJsonBody(session);
                database.saveAdminConfiguration(request);
                return json(Response.Status.OK, database.adminConfiguration().toString());
            } catch (IllegalArgumentException exception) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"" + escapeJson(exception.getMessage()) + "\"}");
            } catch (Exception exception) {
                android.util.Log.e("KioskHttpServer", "Could not save kiosk configuration", exception);
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Could not save kiosk configuration\"}");
            }
        }
        if (Method.POST.equals(method) && "/api/admin/videos".equals(uri)) {
            return uploadVideo(session);
        }
        if (Method.GET.equals(method) && uri.startsWith("/media/")) {
            return serveUploadedMedia(uri);
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
            order.put("status", "new");
            order.put("paymentStatus", "pending");
            order.put("printStatus", "queued");
            order.put("billPrintStatus", "queued");
            order.put("tokenPrintStatus", "waiting");
            order.put("createdAt", System.currentTimeMillis());
            orders.put(order);
            boolean persisted = preferences.edit()
                    .putString(PREF_ORDERS, orders.toString())
                    .putInt("last_token_number", tokenNumber)
                    .commit();
            if (!persisted) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"The order could not be saved. Please ask staff for help.\"}");
            }
            scheduleOrderPrint(orderId + 1);

            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("order", order);
            return json(Response.Status.OK, result.toString());
        } catch (Exception exception) {
            return json(Response.Status.BAD_REQUEST, "{\"error\":\"Invalid order request\"}");
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
            result.put("daily", dailyStats(orders));
        } catch (JSONException exception) {
            return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Stats unavailable\"}");
        }
        return json(Response.Status.OK, result.toString());
    }

    private void scheduleOrderPrint(int orderId) {
        printQueue.execute(() -> {
            printSection(orderId, "bill");
            try {
                int delay = Math.min(3, Math.max(2,
                        database.settings().optInt("token_print_delay_seconds", 3)));
                TimeUnit.SECONDS.sleep(delay);
            } catch (JSONException exception) {
                android.util.Log.e("KioskHttpServer", "Could not load token print delay", exception);
                updatePrintStatus(orderId, "token", "failed", "Token print delay could not be loaded.");
                return;
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                updatePrintStatus(orderId, "token", "failed", "Token print was interrupted.");
                return;
            }
            printSection(orderId, "token");
        });
    }

    private void resumeQueuedPrints() {
        JSONArray orders = readOrders();
        for (int i = 0; i < orders.length(); i++) {
            JSONObject order = orders.optJSONObject(i);
            if (order == null) continue;
            int orderId = order.optInt("id");
            String billStatus = order.optString("billPrintStatus");
            String tokenStatus = order.optString("tokenPrintStatus");
            if ("queued".equals(billStatus)) {
                scheduleOrderPrint(orderId);
            } else if ("printed".equals(billStatus) &&
                    ("waiting".equals(tokenStatus) || "queued".equals(tokenStatus))) {
                printQueue.execute(() -> printSection(orderId, "token"));
            } else if ("queued".equals(tokenStatus)) {
                printQueue.execute(() -> printSection(orderId, "token"));
            }
        }
    }

    private void printSection(int orderId, String kind) {
        JSONObject order = findOrder(orderId);
        if (order == null) return;
        updatePrintStatus(orderId, kind, "printing", "");
        order = findOrder(orderId);
        if (order == null) return;
        try {
            BluetoothPrinter.print(context, "bill".equals(kind) ? billBytes(order) : tokenBytes(order));
            updatePrintStatus(orderId, kind, "printed", "");
        } catch (Exception exception) {
            updatePrintStatus(orderId, kind, "failed", exception.getMessage());
        }
    }

    private void queueOrderPrint(int orderId) throws JSONException {
        JSONObject order = findOrder(orderId);
        if (order == null) throw new IllegalArgumentException("Order not found");
        updatePrintStatus(orderId, "bill", "queued", "");
        updatePrintStatus(orderId, "token", "waiting", "");
        scheduleOrderPrint(orderId);
    }

    private void queuePrintRetry(int orderId, String kind) throws JSONException {
        if (findOrder(orderId) == null) throw new IllegalArgumentException("Order not found");
        updatePrintStatus(orderId, kind, "queued", "");
        printQueue.execute(() -> printSection(orderId, kind));
    }

    private synchronized JSONObject findOrder(int orderId) {
        JSONArray orders = readOrders();
        for (int i = 0; i < orders.length(); i++) {
            JSONObject order = orders.optJSONObject(i);
            if (order != null && order.optInt("id") == orderId) return order;
        }
        return null;
    }

    private synchronized void updatePrintStatus(int orderId, String kind, String status, String error) {
        JSONArray orders = readOrders();
        String field = "bill".equals(kind) ? "billPrintStatus" : "tokenPrintStatus";
        for (int i = 0; i < orders.length(); i++) {
            JSONObject order = orders.optJSONObject(i);
            if (order == null || order.optInt("id") != orderId) continue;
            try {
                order.put(field, status);
                if (error == null || error.isEmpty()) {
                    order.remove("bill".equals(kind) ? "billPrintError" : "tokenPrintError");
                } else {
                    order.put("bill".equals(kind) ? "billPrintError" : "tokenPrintError", error);
                }
                String billStatus = "bill".equals(kind) ? status : order.optString("billPrintStatus");
                String tokenStatus = "token".equals(kind) ? status : order.optString("tokenPrintStatus");
                String combinedStatus = "failed".equals(billStatus) || "failed".equals(tokenStatus)
                        ? "failed"
                        : "printed".equals(billStatus) && "printed".equals(tokenStatus)
                                ? "printed"
                                : "queued";
                order.put("printStatus", combinedStatus);
                try {
                    persistOrders(orders);
                } catch (IllegalStateException exception) {
                    android.util.Log.e("KioskHttpServer", "Could not persist print status", exception);
                }
            } catch (JSONException exception) {
                android.util.Log.e("KioskHttpServer", "Could not update order print status", exception);
            }
            return;
        }
    }

    private byte[] billBytes(JSONObject order) throws JSONException {
        StringBuilder receipt = new StringBuilder();
        int tokenNumber = order.optInt("tokenNumber", order.optInt("id") + 100);
        JSONObject settings = database.settings();
        String businessName = settings.optString("business_name", "FOOD KIOSK");
        String heading = settings.optString("receipt_bill_heading", "KITCHEN ORDER / CUSTOMER BILL");
        int scale = Math.min(3, Math.max(1, settings.optInt("receipt_font_scale", 1)));
        int fontSize = scale == 1 ? 0 : scale == 2 ? 0x11 : 0x22;
        String orderTime = new java.text.SimpleDateFormat(
                "dd/MM/yyyy hh:mm a",
                java.util.Locale.getDefault()
        ).format(new java.util.Date(order.optLong("createdAt", System.currentTimeMillis())));
        receipt.append("\u001b@\u001ba\u0001").append(businessName).append('\n')
                .append("\u001bE\u0001\u001d!").append((char) fontSize).append(heading).append("\u001d!\u0000\u001bE\u0000\n")
                .append("\u001ba\u0000------------------------------\n")
                .append("\u001bE\u0001\u001d!\u0011TOKEN #").append(tokenNumber).append("\u001d!\u0000\u001bE\u0000\n")
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
        receipt.append("------------------------------\nAMOUNT DUE INR ")
                .append(String.format(java.util.Locale.US, "%.2f", order.optDouble("total")))
                .append("\n\u001bE\u0001COLLECT THIS ORDER SUMMARY BILL\u001bE\u0000")
                .append("\nPAYMENT AT COUNTER\n\n\n\u001dV\u0000");
        return receipt.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private byte[] tokenBytes(JSONObject order) throws JSONException {
        int tokenNumber = order.optInt("tokenNumber", order.optInt("id") + 100);
        JSONObject settings = database.settings();
        String businessName = settings.optString("business_name", "FOOD KIOSK");
        String heading = settings.optString("receipt_token_heading", "CUSTOMER TOKEN");
        String instruction = settings.optString("receipt_token_instruction", "Keep this token for collection.");
        int scale = Math.min(3, Math.max(1, settings.optInt("receipt_font_scale", 1)));
        int fontSize = scale == 1 ? 0 : scale == 2 ? 0x11 : 0x22;
        String slip = "\u001b@\u001ba\u0001" + businessName + "\n" +
                "\u001bE\u0001" + heading + "\u001bE\u0000\n" +
                "\u001ba\u0000------------------------------\n" +
                "\u001ba\u0001\u001bE\u0001\u001d!" + (char) fontSize + "TOKEN #" + tokenNumber + "\u001d!\u0000\u001bE\u0000\n" +
                "\u001ba\u0000------------------------------\n" +
                "\u001bE\u0001" + instruction + "\u001bE\u0000\n\n\n\u001dV\u0000";
        return slip.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private JSONObject dailyStats(JSONArray orders) throws JSONException {
        java.text.SimpleDateFormat dayFormat = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
        java.util.Calendar today = java.util.Calendar.getInstance();
        java.util.Map<String, JSONObject> days = new java.util.LinkedHashMap<>();
        for (int offset = 6; offset >= 0; offset--) {
            java.util.Calendar day = (java.util.Calendar) today.clone();
            day.add(java.util.Calendar.DAY_OF_YEAR, -offset);
            String date = dayFormat.format(day.getTime());
            JSONObject row = new JSONObject();
            row.put("date", date);
            row.put("orders", 0);
            row.put("paidOrders", 0);
            row.put("revenue", 0);
            days.put(date, row);
        }
        synchronized (this) {
            for (int i = 0; i < orders.length(); i++) {
                JSONObject order = orders.optJSONObject(i);
                if (order == null) continue;
                long createdAt = order.optLong("createdAt");
                if (createdAt <= 0) continue;
                JSONObject row = days.get(dayFormat.format(new java.util.Date(createdAt)));
                if (row == null) continue;
                row.put("orders", row.optInt("orders") + 1);
                if ("paid".equals(order.optString("paymentStatus"))) {
                    row.put("paidOrders", row.optInt("paidOrders") + 1);
                    row.put("revenue", row.optDouble("revenue") + order.optDouble("total"));
                }
            }
        }
        JSONObject result = new JSONObject();
        for (java.util.Map.Entry<String, JSONObject> entry : days.entrySet()) {
            result.put(entry.getKey(), entry.getValue());
        }
        return result;
    }

    private Response uploadVideo(IHTTPSession session) {
        Map<String, String> files = new HashMap<>();
        try {
            session.parseBody(files);
            String temporaryPath = files.get("video");
            List<String> fileNames = session.getParameters().get("video");
            if (temporaryPath == null || fileNames == null || fileNames.isEmpty()) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"Choose a video file to upload.\"}");
            }
            String fileName = fileNames.get(0).toLowerCase(java.util.Locale.ROOT);
            List<String> kinds = session.getParameters().get("kind");
            boolean promo = kinds != null && !kinds.isEmpty() && "promo".equals(kinds.get(0));
            boolean video = fileName.endsWith(".mp4") || fileName.endsWith(".webm");
            boolean image = fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") ||
                    fileName.endsWith(".png") || fileName.endsWith(".webp");
            if (!video && !(promo && image)) {
                return json(Response.Status.BAD_REQUEST, promo
                        ? "{\"error\":\"Upload MP4, WebM, JPG, PNG, or WebP media.\"}"
                        : "{\"error\":\"Upload an MP4 or WebM video.\"}");
            }
            File temporary = new File(temporaryPath);
            if (!temporary.isFile() || temporary.length() == 0 || temporary.length() > 20L * 1024 * 1024) {
                return json(Response.Status.BAD_REQUEST, "{\"error\":\"Media must be between 1 byte and 20 MB.\"}");
            }
            File folder = new File(context.getFilesDir(), "kiosk-media");
            if (!folder.exists() && !folder.mkdirs()) {
                return json(Response.Status.INTERNAL_ERROR, "{\"error\":\"Could not prepare video storage.\"}");
            }
            String extension = fileName.substring(fileName.lastIndexOf('.'));
            File destination = new File(folder, UUID.randomUUID() + extension);
            try (FileInputStream input = new FileInputStream(temporary);
                 FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            String path = "/media/" + destination.getName();
            return json(Response.Status.OK, "{\"url\":\"" + path + "\"}");
        } catch (Exception exception) {
            android.util.Log.e("KioskHttpServer", "Media upload failed", exception);
            return json(Response.Status.BAD_REQUEST, "{\"error\":\"Media upload failed. Check the file format and 20 MB size limit.\"}");
        }
    }

    private Response serveUploadedMedia(String uri) {
        String fileName = uri.substring("/media/".length());
        if (!fileName.matches("[A-Za-z0-9._-]{1,150}") || fileName.contains("..")) {
            return text(Response.Status.BAD_REQUEST, "Invalid media path");
        }
        File file = new File(new File(context.getFilesDir(), "kiosk-media"), fileName);
        if (!file.isFile()) return text(Response.Status.NOT_FOUND, "Video not found");
        try {
            String mime = fileName.endsWith(".webm") ? "video/webm"
                    : fileName.endsWith(".png") ? "image/png"
                    : fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") ? "image/jpeg"
                    : fileName.endsWith(".webp") ? "image/webp"
                    : "video/mp4";
            return cors(newFixedLengthResponse(Response.Status.OK, mime, new FileInputStream(file), file.length()));
        } catch (IOException exception) {
            android.util.Log.e("KioskHttpServer", "Could not serve video", exception);
            return text(Response.Status.INTERNAL_ERROR, "Could not load video");
        }
    }

    private void persistOrders(JSONArray orders) {
        if (!preferences.edit().putString(PREF_ORDERS, orders.toString()).commit()) {
            throw new IllegalStateException("Could not save order updates.");
        }
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

    private synchronized JSONArray readOrders() {
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
        if ("/admin.html".equals(uri) || "/index.html".equals(uri)) {
            return text(Response.Status.NOT_FOUND, "This page is available in the Food Kiosk app only.");
        }
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

    private boolean isInAppAdminRequest(IHTTPSession session) {
        String origin = session.getHeaders().get("origin");
        return "https://localhost".equals(origin);
    }

    private Response json(Response.IStatus status, String body) {
        return cors(newFixedLengthResponse(status, "application/json; charset=utf-8", body));
    }

    private Response text(Response.IStatus status, String body) {
        return cors(newFixedLengthResponse(status, "text/plain; charset=utf-8", body));
    }

    private Response cors(Response response) {
        response.addHeader("Access-Control-Allow-Origin", "*");
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.addHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
        response.addHeader("Access-Control-Allow-Private-Network", "true");
        response.addHeader("Access-Control-Max-Age", "600");
        return response;
    }
}