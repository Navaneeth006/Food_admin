package com.appkiosk.phone;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KioskServer")
public class KioskServerPlugin extends Plugin {
    @Override
    public void load() {
        SharedPreferences preferences = preferences();
        if (!preferences.contains(KioskServerService.PREF_SERVER_ENABLED)) {
            preferences.edit().putBoolean(KioskServerService.PREF_SERVER_ENABLED, true).apply();
        }
        if (preferences.getBoolean(KioskServerService.PREF_SERVER_ENABLED, false)) {
            startForegroundService();
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        SharedPreferences preferences = preferences();
        JSObject result = new JSObject();
        result.put("enabled", preferences.getBoolean(KioskServerService.PREF_SERVER_ENABLED, false));
        result.put("running", preferences.getBoolean(KioskServerService.PREF_SERVER_RUNNING, false));
        result.put("ipAddress", KioskServerService.getLocalIpv4Address());
        result.put("port", KioskHttpServer.SERVER_PORT);
        result.put("error", preferences.getString(KioskServerService.PREF_SERVER_ERROR, ""));
        call.resolve(result);
    }

    @PluginMethod
    public void startServer(PluginCall call) {
        preferences().edit()
                .putBoolean(KioskServerService.PREF_SERVER_ENABLED, true)
                .putString(KioskServerService.PREF_SERVER_ERROR, "")
                .apply();
        try {
            startForegroundService();
            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Android could not start the kiosk server: " + exception.getMessage());
        }
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        Context context = getContext();
        preferences().edit()
                .putBoolean(KioskServerService.PREF_SERVER_ENABLED, false)
                .apply();
        context.stopService(new Intent(context, KioskServerService.class));
        call.resolve();
    }

    @PluginMethod
    public void getPairedPrinters(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("devices", BluetoothPrinter.pairedDevices(getContext()));
            result.put("selectedAddress", BluetoothPrinter.selectedAddress(getContext()));
            call.resolve(result);
        } catch (Exception exception) {
            call.reject(exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public void selectPrinter(PluginCall call) {
        String address = call.getString("address", "");
        try {
            BluetoothPrinter.select(getContext(), address);
            call.resolve();
        } catch (Exception exception) {
            call.reject(exception.getMessage(), exception);
        }
    }

    @PluginMethod
    public void testPrint(PluginCall call) {
        new Thread(() -> {
            try {
                BluetoothPrinter.print(getContext(), BluetoothPrinter.testReceipt());
                call.resolve();
            } catch (Exception exception) {
                call.reject(exception.getMessage(), exception);
            }
        }, "kiosk-printer-test").start();
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private void startForegroundService() {
        Context context = getContext();
        ContextCompat.startForegroundService(
                context,
                new Intent(context, KioskServerService.class)
        );
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(KioskServerService.PREFERENCES_NAME, Context.MODE_PRIVATE);
    }
}