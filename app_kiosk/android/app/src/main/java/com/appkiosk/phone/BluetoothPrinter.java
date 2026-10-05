package com.appkiosk.phone;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.util.UUID;

public final class BluetoothPrinter {
    private static final UUID SERIAL_PORT_PROFILE = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PREFERENCES_NAME = "kiosk_server";
    private static final String PRINTER_ADDRESS_KEY = "bluetooth_printer_address";

    private BluetoothPrinter() {}

    public static JSONArray pairedDevices(Context context) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new IllegalStateException("This phone does not support Bluetooth.");
        requireConnectPermission(context);
        JSONArray result = new JSONArray();
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            JSONObject entry = new JSONObject();
            entry.put("name", device.getName() == null ? "Bluetooth printer" : device.getName());
            entry.put("address", device.getAddress());
            result.put(entry);
        }
        return result;
    }

    public static String selectedAddress(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .getString(PRINTER_ADDRESS_KEY, "");
    }

    public static void select(Context context, String address) throws Exception {
        boolean found = false;
        JSONArray devices = pairedDevices(context);
        for (int i = 0; i < devices.length(); i++) {
            if (address.equalsIgnoreCase(devices.getJSONObject(i).optString("address"))) {
                found = true;
                break;
            }
        }
        if (!found) throw new IllegalArgumentException("Pair the printer in Android Bluetooth settings first.");
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit().putString(PRINTER_ADDRESS_KEY, address).apply();
    }

    public static void print(Context context, byte[] bytes) throws Exception {
        String address = selectedAddress(context);
        if (address.isEmpty()) throw new IllegalStateException("Select a paired Bluetooth printer first.");
        requireConnectPermission(context);
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) throw new IllegalStateException("Turn Bluetooth on and pair the printer.");

        BluetoothDevice device = adapter.getRemoteDevice(address);
        try (BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SERIAL_PORT_PROFILE)) {
            adapter.cancelDiscovery();
            socket.connect();
            OutputStream output = socket.getOutputStream();
            output.write(bytes);
            output.flush();
        }
    }

    public static byte[] testReceipt() {
        return new byte[]{0x1b, 0x40, 0x1b, 0x61, 0x01,
                0x1b, 0x45, 0x01, 'F', 'O', 'O', 'D', ' ', 'K', 'I', 'O', 'S', 'K',
                0x1b, 0x45, 0x00, 0x0a,
                'B', 'l', 'u', 'e', 't', 'o', 'o', 't', 'h', ' ', 'p', 'r', 'i', 'n', 't', ' ', 't', 'e', 's', 't', 0x0a,
                0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00};
    }

    private static void requireConnectPermission(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Allow Nearby devices/Bluetooth permission in Android settings.");
        }
    }
}